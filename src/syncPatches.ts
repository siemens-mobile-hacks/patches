import fs from 'node:fs';
import path from 'node:path';
import yauzl from 'yauzl';
import iconv from 'iconv-lite';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { globSync } from 'glob';
import child_process from 'child_process';
import { KibabAPI } from './KibabAPI.js';
import { fileMD5, findZipStart, getChunks, readFiles, wget } from "./utils.js";

// Define interfaces for the data structures
interface PatchInfo {
	id: number;
	model: string;
	file: string;
	additionalFile?: string;
	mtime: number;
	title: {
		ru: string;
		en: string;
	};
}

interface IndexData {
	[model: string]: {
		[patchId: number]: PatchInfo;
	};
}

interface ZipPatchInfo {
	fileName: string;
	time: number;
	data: Buffer;
}

interface BadPatch {
	id: number;
	error: string;
}

// patches.kibab.com timezone
process.env.TZ = 'Europe/Moscow'; // thanks Viktor89

const argv = await yargs(hideBin(process.argv))
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
		type: 'string',
		description: 'Run sync starting from specified model.',
		default: false
	})
	.option('patches', {
		type: 'string',
		description: 'Patches IDs for partial sync.',
		default: undefined
	})
	.option('output', {
		type: 'string',
		description: 'Output dir.',
		default: path.resolve(`${import.meta.dirname}/../patches/`)
	})
	.parse();

const OUT_DIR = argv.output;
if (!fs.existsSync(OUT_DIR)) {
	console.error(`Output dir not exists: ${OUT_DIR}`);
	process.exit(1);
}

if (!argv.cookie) {
	console.error(`--cookie is not set!`);
	process.exit(1);
}

const [login, password] = argv.cookie.split(':');
const api = new KibabAPI(login, password);

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

async function removeDeletedPatches(api: KibabAPI): Promise<void> {
	let deletedCnt = 0;
	let page = 0;
	const indexData: IndexData = loadIndex();

	do {
		deletedCnt = 0;

		const deletedPatches = await api.getDeletedPatches(page);
		for (const p of deletedPatches) {
			for (const file of globSync(`${OUT_DIR}/${p.model}/${p.id}-*`)) {
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

async function syncPatches(api: KibabAPI): Promise<void> {
	if (argv["full-sync"]) {
		console.log("-------------------------------------------------");
		console.log(`Full sync mode!!!`);
		console.log("-------------------------------------------------");
	}

	if (argv["patches"]) {
		const patchesToSync = argv["patches"].split(/\s*,\s*/).map((v) => parseInt(v));
		await downloadPatches(api, patchesToSync, true);
		return;
	}

	let flag = false;
	const allModels = await api.getAllModels();
	for (const model of allModels) {
		console.log(`[${model.name}]`);
		fs.mkdirSync(`${OUT_DIR}/${model.name}`, { recursive: true });

		if (argv["from-model"] && model.name != argv["from-model"] && !flag)
			continue;
		flag = true;

		const allModelPatches = await api.getAllPatches(model.modelId, model.swId);
		const allModelPatchesIds = allModelPatches.map((p) => p.id);
		await downloadPatches(api, allModelPatchesIds, argv["full-sync"]);
	}
}

function generateFilesList(): void {
	const indexData: IndexData = loadIndex();
	const indexList: { [id: number]: string[] } = [];
	for (const model in indexData) {
		for (const patch of Object.values(indexData[model])) {
			indexList[patch.id] = [];
			indexList[patch.id].push(patch.file);
			if (patch.additionalFile)
				indexList[patch.id].push(patch.additionalFile);
		}
	}
	fs.writeFileSync(`${OUT_DIR}/files.json`, JSON.stringify(indexList, null, '\t'));
}

function garbageCollector(): void {
	const indexData: IndexData = loadIndex();
	const allUsedFiles: { [file: string]: boolean } = {};
	for (const model in indexData) {
		for (const patch of Object.values(indexData[model])) {
			allUsedFiles[patch.file] = true;
			if (patch.additionalFile)
				allUsedFiles[patch.additionalFile] = true;
		}
	}

	for (const file of readFiles(OUT_DIR)) {
		if (file.indexOf('/') < 0)
			continue;

		if (!(file in allUsedFiles)) {
			console.log(`Redundant file: ${file}`);
			child_process.spawnSync("git", ["rm", file], { cwd: OUT_DIR });
		}
	}
}

async function downloadPatches(api: KibabAPI, allPatchesIds: number[], fullSync: boolean): Promise<void> {
	let chunkId = 0;
	let unchangedPatches = 0;
	const indexData: IndexData = loadIndex();
	const badPatches: BadPatch[] = [];

	for (const model in indexData) {
		for (const patch of Object.values(indexData[model])) {
			patch.id = +patch.id;
		}
	}

	const chunks = getChunks(allPatchesIds, 10);
	if (!fullSync && chunks.length > 0 && chunks[0].length >= 5)
		chunks.unshift([chunks[0].shift()!]);

	while (chunks.length > 0) {
		const chunk = chunks.shift()!;

		console.log(`chunk #${chunkId} [`, chunk.join(', '), `]`);

		await api.clearCart();
		const notAddedIds = await api.addToCart(chunk);
		if (notAddedIds.length > 0) {
			for (const pid of notAddedIds.reverse())
				chunks.unshift([pid]);
		}

		let blob = await api.downloadCart();

		findBrokenFiles(blob);
		const zipStartOffset = findZipStart(blob);
		if (zipStartOffset < 0) {
			console.error(`NOT ZIP, see here: /tmp/invalid-patch.zip`);
			fs.writeFileSync(`/tmp/invalid-patch.zip`, blob)
			throw new Error(`Invalid ZIP:`);
		}

		blob = blob.subarray(zipStartOffset);

		let patchesFromZip;
		try {
			patchesFromZip = await getPatchesFromArchive(blob);
		} catch (e) {
			console.log(`Invalid ZIP:`, e);
			console.error(`See here: /tmp/invalid-patch.zip`);
			fs.writeFileSync(`/tmp/invalid-patch.zip`, blob)
			throw e;
		}

		for (const member of patchesFromZip) {
			const patchText = iconv.decode(member.data, 'win1251');
			const patchId = parseInt(patchText.match(/;PatchID: (\d+)/i)?.[1] ?? "");
			const lines = patchText.split(/\r\n/);
			const model = lines[0].replace(/^;/, '').trim();
			const titleRU = lines[1].replace(/^;/, '').trim();
			const titleEN = lines[2].replace(/^;/, '').trim();

			indexData[model] = indexData[model] || {};

			const patchFile = `${model}/${patchId}-${path.basename(member.fileName)}`;

			console.log(`+ ${patchId}: ${patchFile}`);

			let oldPatchHash;
			let oldPatch: PatchInfo | undefined = indexData[model][patchId];
			if (oldPatch && !fs.existsSync(`${OUT_DIR}/${oldPatch.file}`))
				oldPatch = undefined;

			if (oldPatch) {
				oldPatchHash = fileMD5(`${OUT_DIR}/${oldPatch.file}`);

				if (oldPatch.file != patchFile) {
					console.log(`  rename ${oldPatch.file} -> ${patchFile}`);
					child_process.spawnSync("git", ["add", oldPatch.file], { cwd: OUT_DIR });
					child_process.spawnSync("git", ["mv", oldPatch.file, patchFile], { cwd: OUT_DIR });
				}
			}

			let additionalFile;
			const additionalFileLink = patchText.match(/^;!(?:к патчу прикреплён файл|There is a file attached to this patch), (.*?)\r\n$/im)?.[1];
			let oldAdditionalFileHash;
			let newAdditionalFileHash;

			if (additionalFileLink) {
				const parsedUrl = new URL(additionalFileLink);
				additionalFile = `${model}/${patchId}-${path.basename(parsedUrl.searchParams.get('f')!)}`;

				console.log(`+ ${patchId}: ${additionalFile}`);

				if (oldPatch && oldPatch.additionalFile && !fs.existsSync(`${OUT_DIR}/${oldPatch.additionalFile}`))
					oldPatch.additionalFile = undefined;

				if (oldPatch && oldPatch.additionalFile) {
					oldAdditionalFileHash = fileMD5(`${OUT_DIR}/${oldPatch.additionalFile}`);

					if (oldPatch.additionalFile != additionalFile) {
						console.log(`  rename ${oldPatch.additionalFile} -> ${additionalFile}`);
						child_process.spawnSync("git", ["add", oldPatch.additionalFile], { cwd: OUT_DIR });
						child_process.spawnSync("git", ["mv", oldPatch.additionalFile, additionalFile], { cwd: OUT_DIR });
					}
				}

				const additionalData = await wget(additionalFileLink);
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

			const newPatch: PatchInfo = {
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
			const newPatchHash = fileMD5(`${OUT_DIR}/${patchFile}`);

			const changed = newPatchHash !== oldPatchHash ||
				newAdditionalFileHash !== oldAdditionalFileHash ||
				JSON.stringify(oldPatch) != JSON.stringify(newPatch);

			if (changed) {
				indexData[model][patchId] = newPatch;
				unchangedPatches = 0;
			} else {
				unchangedPatches++;
			}
		}

		if (unchangedPatches >= 1 && !fullSync) {
			// console.log(`STOP: unchangedPatches=${unchangedPatches}`);
			break;
		}

		chunkId++;
	}
	saveIndex(indexData);

	if (badPatches.length) {
		console.log(`ERRORS:`);
		for (const err of badPatches) {
			console.log(`#${err.id}: ${err.error}`);
		}
	}
}

function loadIndex(): IndexData {
	const indexData: IndexData = {};
	if (fs.existsSync(`${OUT_DIR}/index.json`))
		return JSON.parse(fs.readFileSync(`${OUT_DIR}/index.json`, 'utf-8'));
	return indexData;
}

function saveIndex(indexData: IndexData): void {
	fs.writeFileSync(`${OUT_DIR}/index.json`, JSON.stringify(indexData, null, '\t'));
}

function findBrokenFiles(blob: Buffer): void {
	let m;
	const RE_BROKEN_FILES = /fopen\((.*?)\):/gi;
	while ((m = RE_BROKEN_FILES.exec(blob.toString()))) {
		console.error(`!!!! broken file:`, m[1]);
	}
}

function getPatchesFromArchive(buffer: Buffer): Promise<ZipPatchInfo[]> {
	const patches: ZipPatchInfo[] = [];

	return new Promise((callback, error) => {
		yauzl.fromBuffer(buffer, {lazyEntries: true}, function (err, zipfile) {
			if (err)
				return error(err);
			zipfile.readEntry();
			zipfile.on("entry", (entry) => {
				const buffers: Buffer[] = [];
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
