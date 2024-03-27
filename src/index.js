import fs from 'fs';
import yauzl from 'yauzl';
import iconv from 'iconv-lite';
import crypto from 'crypto';
import path from 'path';
import child_process from 'child_process';
import { KibabAPI } from './KibabAPI.js';

// patches.kibab.com timezone
process.env.TZ = 'Europe/Moscow'; // thanks Viktor89

let TMP_DIR = `${import.meta.dirname}/../tmp`;
let OUT_DIR = `${import.meta.dirname}/../patches`;

if (!process.env.KIBAB_TEST_USER) {
	console.error(`KIBAB_TEST_USER is not set!`);
	process.exit(1);
}

let [login, password] = process.env.KIBAB_TEST_USER.split(':');

let api = new KibabAPI(login, password);
let all_models = await api.getAllModels();
for (let model of all_models) {
	console.log(`[${model.name}]`);
	fs.mkdirSync(`${OUT_DIR}/${model.name}`, { recursive: true });
	
	let all_model_patches = await api.getAllPatches(model.modelId, model.swId);
	let all_patches_ids = all_model_patches.map((p) => p.id);
	
	await downloadPatches(api, all_patches_ids, false);
}

let index_data = {};
if (fs.existsSync(`${OUT_DIR}/index.json`))
	index_data = JSON.parse(fs.readFileSync(`${OUT_DIR}/index.json`));

let index_list = [];
for (let model in index_data) {
	for (let patch of Object.values(index_data[model])) {
		index_list[patch.id] = [];
		if (patch.file)
			index_list[patch.id].push(patch.file);
		if (patch.additionalFile)
			index_list[patch.id].push(patch.additionalFile);
	}
}

fs.writeFileSync(`${OUT_DIR}/files.json`, JSON.stringify(index_list, null, '\t'));

async function downloadPatches(api, all_patches_ids, force_all) {
	let chunk_id = 0;
	let unchnaged_patches = 0;
	let index_data = {};
	
	if (fs.existsSync(`${OUT_DIR}/index.json`))
		index_data = JSON.parse(fs.readFileSync(`${OUT_DIR}/index.json`));
	
	let chunks = getChunks(all_patches_ids, 10);
	while (chunks.length > 0) {
		let chunk = chunks.shift();
		
		console.log(`chunk #${chunk_id} [`, chunk.join(', '), `]`);
		
		await api.clearCart();
		let not_added = await api.addToCart(chunk);
		if (not_added.length > 0) {
			for (let not_added_pid of not_added.reverse())
				chunks.unshift([not_added_pid]);
		}
		
		let blob = await api.downloadCart();
		
		findBrokenFiles(blob);
		let found_zip_start = findZipStart(blob);
		if (found_zip_start < 0) {
			console.error(`NOT ZIP, see here: /tmp/invalid-patch.zip`);
			fs.writeFileSync(`/tmp/invalid-patch.zip`, blob)
			throw new Error(`Invalid ZIP:`);
		}
		
		blob = blob.slice(found_zip_start);
		
		let patches_from_zip;
		try {
			patches_from_zip = await getPatchesFromArchive(blob);
		} catch (e) {
			console.log(`Invalid ZIP:`, e);
			console.error(`See here: /tmp/invalid-patch.zip`);
			fs.writeFileSync(`/tmp/invalid-patch.zip`, blob)
			throw e;
		}
		
		for (let member of patches_from_zip) {
			let patch_text = iconv.decode(member.data, 'win1251');
			let patch_id = patch_text.match(/;PatchID: (\d+)/i)[1];
			let lines = patch_text.split(/\r\n/);
			let model = lines[0].replace(/^;/, '').trim();
			let title_ru = lines[1].replace(/^;/, '').trim();
			let title_en = lines[2].replace(/^;/, '').trim();
			
			index_data[model] = index_data[model] || {};
			
			let patch_file = `${model}/${path.basename(member.fileName)}`;
			
			console.log(`+ ${patch_id}: ${patch_file}`);
			
			let old_patch_md5;
			let old_patch = index_data[model][patch_id];
			if (old_patch) {
				if (old_patch.file != patch_file) {
					console.log(`  rename ${old_patch.file} -> ${patch_file}`);
					child_process.spawnSync("git", ["add", old_patch.file], { cwd: OUT_DIR });
					child_process.spawnSync("git", ["mv", old_patch.file, patch_file], { cwd: OUT_DIR });
				}
				old_patch_md5 = fileMD5(`${OUT_DIR}/${old_patch.file}`);
			}
			
			let additional_file;
			let additional_file_link = patch_text.match(/^;!к патчу прикреплён файл, (.*?)\r\n$/im)?.[1];
			let old_additional_file_md5;
			let new_additional_file_md5;
			
			if (additional_file_link) {
				let parsed_url = new URL(additional_file_link);
				additional_file = `${model}/${path.basename(parsed_url.searchParams.get('f'))}`;
				
				console.log(`+ ${patch_id}: ${additional_file}`);
				
				if (old_patch && old_patch.additionalFile) {
					old_additional_file_md5 = fileMD5(`${OUT_DIR}/${old_patch.additionalFile}`);
					
					if (old_patch.additionalFile != additional_file) {
						console.log(`  rename ${old_patch.additionalFile} -> ${additional_file}`);
						child_process.spawnSync("git", ["add", old_patch.additionalFile], { cwd: OUT_DIR });
						child_process.spawnSync("git", ["mv", old_patch.additionalFile, additional_file], { cwd: OUT_DIR });
					}
				}
				
				let additional_data = await fetch(additional_file_link).then((res) => res.arrayBuffer()).then((res) => Buffer.from(res));
				fs.writeFileSync(`${OUT_DIR}/${additional_file}`, additional_data);
				
				new_additional_file_md5 = fileMD5(`${OUT_DIR}/${additional_file}`);
			}
			
			let new_patch = {
				id:				patch_id,
				model:			model,
				file:			patch_file,
				additionalFile:	additional_file,
				mtime:			member.time,
				title:	{
					ru:		title_ru,
					en:		title_en,
				}
			};
			
			/*
			if (old_patch && Math.abs(new_patch.mtime - old_patch.mtime) == 3600000) {
				let delta = new_patch.mtime - old_patch.mtime;
				for (let p of Object.values(index_data[model])) {
					p.mtime += delta;
				}
				console.log('apply time hack');
			}
			*/
			
			fs.writeFileSync(`${OUT_DIR}/${patch_file}`, member.data);
			let new_patch_md5 = fileMD5(`${OUT_DIR}/${patch_file}`);
			
			let changed;
			if (new_patch_md5 !== old_patch_md5 || new_additional_file_md5 !== old_additional_file_md5) {
				changed = true;
			} else {
				changed = JSON.stringify(old_patch) != JSON.stringify(new_patch);
			}
			
			if (changed) {
				index_data[model][patch_id] = new_patch;
				unchnaged_patches = 0;
			} else {
				unchnaged_patches++;
			}
		}
		
		if (unchnaged_patches >= 10 && !force_all) {
			console.log(`STOP: unchnaged_patches=${unchnaged_patches}`);
			break;
		}
		
		chunk_id++;
	}
	fs.writeFileSync(`${OUT_DIR}/index.json`, JSON.stringify(index_data, null, '\t'));
}

function findBrokenFiles(blob) {
	let m;
	let RE_BROKEN_FILES = /fopen\((.*?)\):/gi;
	while ((m = RE_BROKEN_FILES.exec(blob.toString()))) {
		console.error(`!!!! broken file:`, m[1]);
	}
}

function findZipStart(blob) {
	let found_zip_start = -1;
	for (let i = 0; i < blob.length; i++) {
		if (blob[i] == 0x50 && blob[i + 1] == 0x4b && blob[i + 2] == 0x03 && blob[i + 3] == 0x04) {
			found_zip_start = i;
			break;
		}
	}
	return found_zip_start;
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
