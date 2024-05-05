import fs from 'fs';
import yauzl from 'yauzl';
import iconv from 'iconv-lite';
import crypto from 'crypto';
import path from 'path';
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { globSync } from 'glob';
import child_process from 'child_process';
import { KibabAPI } from './KibabAPI.js';

// patches.kibab.com timezone
process.env.TZ = 'Europe/Moscow'; // thanks Viktor89

const OUT_DIR = `${import.meta.dirname}/../patches`;
const DELETED_DIR = `${import.meta.dirname}/../deleted`;

const argv = yargs(hideBin(process.argv))
	.option('cookie', {
		type: 'string',
		description: 'Kibab cookie: login:password_hash',
		default: ""
	})
	.option('full-sync', {
		type: 'boolean',
		description: 'Run full sync (~3h).',
		default: false
	})
	.option('from-model', {
		type: 'boolean',
		description: 'Run sync starting from specified model.',
		default: false
	})
	.option('patches', {
		type: 'string',
		description: 'Patches IDs for partial sync.',
		default: false
	})
	.parse();

if (!argv.cookie) {
	console.error(`--cookie is not set!`);
	process.exit(1);
}

let [login, password] = argv.cookie.split(':');
let api = new KibabAPI(login, password);

console.time("removeDeletedPatches");
await removeDeletedPatches(api);
console.timeEnd("removeDeletedPatches");

console.time("syncPatches");
await syncPatches(api);
console.timeEnd("syncPatches");

console.time("generateFilesList");
generateFilesList();
console.timeEnd("generateFilesList");

console.time("garbageCollector");
garbageCollector();
console.timeEnd("garbageCollector");

async function removeDeletedPatches(api) {
	let deletedCnt = 0;
	let page = 0;
	let indexData = loadIndex();

	do {
		deletedCnt = 0;

		let deletedPatches = await api.getDeletedPatches(page);
		for (let p of deletedPatches) {
			for (let file of globSync(`${OUT_DIR}/${p.model}/${p.id}-*`)) {
				if (fs.existsSync(file)) {
					child_process.spawnSync("git", ["rm", file], { cwd: OUT_DIR });
					deletedCnt++;
				}

				if (indexData[p.model] && indexData[p.model][p.id]) {
					delete indexData[p.model][p.id];
					deletedCnt++;
				}
			}
		}

		page++;
	} while (deletedCnt > 0);

	saveIndex(indexData);
}

async function syncPatches(api) {
	if (argv["full-sync"]) {
		console.log("-------------------------------------------------");
		console.log(`Full sync mode!!!`);
		console.log("-------------------------------------------------");
	}

	if (argv["patches"]) {
		let patchesToSync = argv["patches"].split(/\s*,\s*/);
		await downloadPatches(api, patchesToSync, true);
		return;
	}

	let allModels = await api.getAllModels();
	let flag = false;
	for (let model of allModels) {
		console.log(`[${model.name}]`);
		fs.mkdirSync(`${OUT_DIR}/${model.name}`, { recursive: true });

		if (argv["from-model"] && model.name != argv["from-model"] && !flag)
			continue;
		flag = true;

		let allModelPatches = await api.getAllPatches(model.modelId, model.swId);
		let allModelPatchesIds = allModelPatches.map((p) => p.id);

		await downloadPatches(api, allModelPatchesIds, argv["full-sync"]);
	}
}

function generateFilesList() {
	let indexData = loadIndex();
	let indexList = [];
	for (let model in indexData) {
		for (let patch of Object.values(indexData[model])) {
			indexList[patch.id] = [];
			indexList[patch.id].push(patch.file);
			if (patch.additionalFile)
				indexList[patch.id].push(patch.additionalFile);
		}
	}
	fs.writeFileSync(`${OUT_DIR}/files.json`, JSON.stringify(indexList, null, '\t'));
}

function garbageCollector() {
	let indexData = loadIndex();
	let allUsedFiles = {};
	for (let model in indexData) {
		for (let patch of Object.values(indexData[model])) {
			allUsedFiles[patch.file] = true;
			if (patch.additionalFile)
				allUsedFiles[patch.additionalFile] = true;
		}
	}

	for (let file of readFiles(OUT_DIR)) {
		if (file.indexOf('/') < 0)
			continue;

		if (!(file in allUsedFiles)) {
			console.log(`Redundant file: ${file}`);
			child_process.spawnSync("git", ["rm", file], { cwd: OUT_DIR });
		}
	}
}

async function downloadPatches(api, allPatchesIds, fullSync) {
	let chunkId = 0;
	let unchnagedPatches = 0;
	let indexData = loadIndex();
	let badPatches = [];

	let chunks = getChunks(allPatchesIds, 10);
	if (!fullSync && chunks.length > 0 && chunks[0].length >= 5)
		chunks.unshift([chunks[0].shift()]);

	while (chunks.length > 0) {
		let chunk = chunks.shift();

		console.log(`chunk #${chunkId} [`, chunk.join(', '), `]`);

		await api.clearCart();
		let notAddedIds = await api.addToCart(chunk);
		if (notAddedIds.length > 0) {
			for (let pid of notAddedIds.reverse())
				chunks.unshift([pid]);
		}

		let blob = await api.downloadCart();

		findBrokenFiles(blob);
		let zipStartOffset = findZipStart(blob);
		if (zipStartOffset < 0) {
			console.error(`NOT ZIP, see here: /tmp/invalid-patch.zip`);
			fs.writeFileSync(`/tmp/invalid-patch.zip`, blob)
			throw new Error(`Invalid ZIP:`);
		}

		blob = blob.slice(zipStartOffset);

		let patchesFromZip;
		try {
			patchesFromZip = await getPatchesFromArchive(blob);
		} catch (e) {
			console.log(`Invalid ZIP:`, e);
			console.error(`See here: /tmp/invalid-patch.zip`);
			fs.writeFileSync(`/tmp/invalid-patch.zip`, blob)
			throw e;
		}

		for (let member of patchesFromZip) {
			let patchText = iconv.decode(member.data, 'win1251');
			let patchId = patchText.match(/;PatchID: (\d+)/i)[1];
			let lines = patchText.split(/\r\n/);
			let model = lines[0].replace(/^;/, '').trim();
			let titleRU = lines[1].replace(/^;/, '').trim();
			let titleEN = lines[2].replace(/^;/, '').trim();

			indexData[model] = indexData[model] || {};

			let patchFile = `${model}/${patchId}-${path.basename(member.fileName)}`;

			console.log(`+ ${patchId}: ${patchFile}`);

			let oldPatchHash;
			let oldPatch = indexData[model][patchId];

			if (oldPatch) {
				oldPatchHash = fileMD5(`${OUT_DIR}/${oldPatch.file}`);

				if (oldPatch.file != patchFile) {
					console.log(`  rename ${oldPatch.file} -> ${patchFile}`);
					child_process.spawnSync("git", ["add", oldPatch.file], { cwd: OUT_DIR });
					child_process.spawnSync("git", ["mv", oldPatch.file, patchFile], { cwd: OUT_DIR });
				}
			}

			let additionalFile;
			let additionalFileLink = patchText.match(/^;!к патчу прикреплён файл, (.*?)\r\n$/im)?.[1];
			let oldAdditionalFileHash;
			let newAdditionalFileHash;

			if (additionalFileLink) {
				let parsedUrl = new URL(additionalFileLink);
				additionalFile = `${model}/${patchId}-${path.basename(parsedUrl.searchParams.get('f'))}`;

				console.log(`+ ${patchId}: ${additionalFile}`);

				if (oldPatch && oldPatch.additionalFile && !fs.existsSync(`${OUT_DIR}/${oldPatch.additionalFile}`))
					oldPatch.additionalFile = null;

				if (oldPatch && oldPatch.additionalFile) {
					oldAdditionalFileHash = fileMD5(`${OUT_DIR}/${oldPatch.additionalFile}`);

					if (oldPatch.additionalFile != additionalFile) {
						console.log(`  rename ${oldPatch.additionalFile} -> ${additionalFile}`);
						child_process.spawnSync("git", ["add", oldPatch.additionalFile], { cwd: OUT_DIR });
						child_process.spawnSync("git", ["mv", oldPatch.additionalFile, additionalFile], { cwd: OUT_DIR });
					}
				}

				let additionalData = await wget(additionalFileLink);
				if (additionalData.status == 404 || additionalData.status == 403) {
					badPatches.push({
						id:		patchId,
						error:	`Additional file http error #${additionalData.status}: ${additionalFileLink}`
					});
					newAdditionalFileHash = oldAdditionalFileHash;
				} else if (additionalData.status == 200) {
					fs.writeFileSync(`${OUT_DIR}/${additionalFile}`, additionalData.body);
					newAdditionalFileHash = fileMD5(`${OUT_DIR}/${additionalFile}`);
				} else {
					throw new Error(`HTTP error ${additionalData.status}`);
				}

				if (!fs.existsSync(`${OUT_DIR}/${additionalFile}`))
					additionalFile = undefined;
			}

			let newPatch = {
				id:				patchId,
				model:			model,
				file:			patchFile,
				additionalFile:	additionalFile,
				mtime:			member.time,
				title:	{
					ru:		titleRU,
					en:		titleEN,
				}
			};

			fs.writeFileSync(`${OUT_DIR}/${patchFile}`, member.data);
			let newPatchHash = fileMD5(`${OUT_DIR}/${patchFile}`);

			let changed;
			if (newPatchHash !== oldPatchHash || newAdditionalFileHash !== oldAdditionalFileHash) {
				changed = true;
			} else {
				changed = JSON.stringify(oldPatch) != JSON.stringify(newPatch);
			}

			if (changed) {
				indexData[model][patchId] = newPatch;
				unchnagedPatches = 0;
			} else {
				unchnagedPatches++;
			}
		}

		if (unchnagedPatches >= 1 && !fullSync) {
			// console.log(`STOP: unchnagedPatches=${unchnagedPatches}`);
			break;
		}

		chunkId++;
	}
	saveIndex(indexData);

	if (badPatches.length) {
		console.log(`ERRORS:`);
		for (let err of badPatches) {
			console.log(`#${err.id}: ${err.error}`);
		}
	}
}

function loadIndex() {
	let indexData = {};
	if (fs.existsSync(`${OUT_DIR}/index.json`))
		indexData = JSON.parse(fs.readFileSync(`${OUT_DIR}/index.json`));
	return indexData;
}

function saveIndex(indexData) {
	fs.writeFileSync(`${OUT_DIR}/index.json`, JSON.stringify(indexData, null, '\t'));
}

function loadDeletedIndex() {
	let indexData = {};
	if (fs.existsSync(`${DELETED_DIR}/index.json`))
		indexData = JSON.parse(fs.readFileSync(`${DELETED_DIR}/index.json`));
	return indexData;
}

function saveDeletedIndex(indexData) {
	fs.writeFileSync(`${DELETED_DIR}/index.json`, JSON.stringify(indexData, null, '\t'));
}

function findBrokenFiles(blob) {
	let m;
	let RE_BROKEN_FILES = /fopen\((.*?)\):/gi;
	while ((m = RE_BROKEN_FILES.exec(blob.toString()))) {
		console.error(`!!!! broken file:`, m[1]);
	}
}

function findZipStart(blob) {
	let foundZipStart = -1;
	for (let i = 0; i < blob.length; i++) {
		if (blob[i] == 0x50 && blob[i + 1] == 0x4b && blob[i + 2] == 0x03 && blob[i + 3] == 0x04) {
			foundZipStart = i;
			break;
		}
	}
	return foundZipStart;
}

function fileMD5(file) {
	return crypto.createHash('md5').update(fs.readFileSync(file)).digest("hex");
}

function getPatchesFromArchive(buffer) {
	let patches = [];

	return new Promise((callback, error) => {
		yauzl.fromBuffer(buffer, {lazyEntries: true}, function (err, zipfile) {
			if (err)
				return error(err);
			zipfile.readEntry();
			zipfile.on("entry", (entry) => {
				let buffers = [];
				zipfile.openReadStream(entry, (err, readStream) => {
					if (err)
						return error(err);
					readStream.on("data", (chunk) => {
						buffers.push(chunk);
					});
					readStream.on("end", () => {
						if (entry.fileName.endsWith(".vkp")) {
							patches.push({
								fileName:	entry.fileName,
								time:		entry.getLastModDate().getTime(),
								data:		Buffer.concat(buffers),
							});
						}
						zipfile.readEntry();
					});
				});
			});
			zipfile.on("error", (err) => {
				error(err);
			});
			zipfile.on("end", () => {
				callback(patches);
			});
		});
	});
}

function getChunks(arr, size) {
	let chunks = [];
	while (arr.length > 0) {
		let chunk = [];
		while (chunk.length < size && arr.length > 0)
			chunk.push(arr.shift());
		chunks.push(chunk);
	}
	return chunks;
}

function addPrefixToFile(file, prefix) {
	return `${path.dirname(file)}/${prefix}${path.basename(file)}`;
}

async function wget(url) {
	let response = await fetch(url);
	return {
		status:	response.status,
		body:	Buffer.from(await response.arrayBuffer())
	};
}

function readFiles(dir, base, files) {
	base = base || "";
	files = files || [];
	fs.readdirSync(dir, {withFileTypes: true}).forEach((entry) => {
		if (entry.isDirectory()) {
			readFiles(dir + "/" + entry.name, base + entry.name + "/", files);
		} else {
			files.push(base + entry.name);
		}
	});
	return files;
}
