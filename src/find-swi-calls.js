import iconv from 'iconv-lite';
import fs from 'fs';
import path from 'path';
import { Blob } from "buffer";
import { globSync } from 'glob';
import { vkpParse, vkpDetectContent, vkpNormalize, vkpNormalizeWithRTF } from '@sie-js/vkp';
import { Const as CapstoneConst, Capstone, loadCapstone } from 'capstone-wasm';
import child_process from 'child_process';

await loadCapstone();

let capstoneARM = new Capstone(CapstoneConst.CS_ARCH_ARM, CapstoneConst.CS_MODE_ARM | CapstoneConst.CS_MODE_LITTLE_ENDIAN);
let capstoneTHUMB = new Capstone(CapstoneConst.CS_ARCH_ARM, CapstoneConst.CS_MODE_THUMB | CapstoneConst.CS_MODE_MCLASS | CapstoneConst.CS_MODE_LITTLE_ENDIAN);

const PATCHES_DIR = path.resolve(`${import.meta.dirname}/../patches`);
const TARGET_MODELS = [
	'C72v22', 'C75v22', 'C75v24', 'C81v51', 'CF75v23', 'CX70v56', 'CX75v13', 'CX75v25', 'E71v45',
	'EL71v45', 'M75v25', 'S65v58', 'S68v47', 'S68v52', 'S75v40', 'S75v47', 'S75v52', 'SK65v50',
	'SL65v53', 'SL75v47', 'SL75v52'
];

for (let file of readFiles(PATCHES_DIR)) {
	if (!file.match(/\.vkp$/))
		continue;

	let patchText = vkpNormalize(fs.readFileSync(`${PATCHES_DIR}/${file}`));
	let patchUrl = patchText.match(/Details: (https?:\/\/.*?)$/m)[1];
	let patchId = patchText.match(/PatchID: (\d+)$/m)[1];
	let [, patchModel, patchTitleRU, patchTitleEN] = patchText.match(/^;(.*?)\n;(.*?)\n;(.*?)\n/si);
	let additionalFile;

	if (!TARGET_MODELS.includes(patchModel))
		continue;

	if (patchText.match(/;!(к патчу прикреплён файл|There is a file attached to this patch), https?:\/\//i))
		[additionalFile] = globSync(`${PATCHES_DIR}/${patchModel}/${patchId}-*.{rar,zip}`);

	let detectedType = vkpDetectContent(patchText);
	if (detectedType == "DOWNLOAD_STUB") {
		if (!additionalFile)
			continue;

		let archive;
		try { archive = await getFilesFromArchive(additionalFile); } catch (e) { }

		if (!archive)
			continue;

		for (let entry of archive.lsarContents) {
			if (entry.XADFileName.match(/\.vkp$/i)) {
				let rawPatchText = await extractFileFromArchive(additionalFile, entry.XADIndex);
				let patchText = await vkpNormalizeWithRTF(rawPatchText);
				analyzePatch(`${additionalFile} -> ${entry.XADFileName}`, patchText);
			}
		}
	} else if (detectedType == "PATCH") {
		analyzePatch(file, patchText);
	}
}

function analyzePatch(file, patchText) {
	let vkp = vkpParse(patchText, {
		allowEmptyOldData:	true,
		allowPlaceholders:	true,
	});

	let chunks = vkpMergeChunks(vkp);
	for (let w of chunks) {
		for (let i = 0; i < w.size; i++) {
			let addr = w.addr + i;

			if ((addr % 4) == 0 && (w.size - i) >= 4) {
				// check for arm
				try {
					let insns = capstoneARM.disasm(w.new.slice(i, i + 4), { address: 0xA0000000 + i });
					if (insns.length && insns[0].mnemonic.startsWith('svc')) {
						let swiNumber = parseInt(insns[0].opStr.substr(1), 16);
						if (swiNumber <= 0xFFF) {
							console.log(file, 'ARM', insns[0].mnemonic, insns[0].opStr);
						}
					}
				} catch (e) { }
			}

			if ((addr % 2) == 0 && (w.size - i) >= 2) {
				// check for thumb
				try {
					let insns = capstoneTHUMB.disasm(w.new.slice(i, i + 2), { address: 0xA0000000 + i });
					if (insns.length && insns[0].mnemonic.startsWith('svc')) {
						let swiNumber = parseInt(insns[0].opStr.substr(1), 16);
						if (swiNumber <= 0xFFF) {
							console.log(file, 'THUMB', insns[0].mnemonic, insns[0].opStr);
						}
					}
				} catch (e) { }
			}
		}
	}
}

function vkpMergeChunks(vkp) {
	let chunks = [];
	let chunkIsSame = (w) => {
		let prevChunk = chunks[chunks.length - 1];
		if ((prevChunk.addr + prevChunk.size) - w.addr != 0)
			return false;

		for (let k in prevChunk.pragmas) {
			if (prevChunk.pragmas[k] !== w.pragmas[k])
				return false;
		}

		if (prevChunk.old && !w.old)
			return false;
		if (!prevChunk.old && w.old)
			return false;

		return true;
	};
	for (let w of vkp.writes) {
		if (!chunks.length || !chunkIsSame(w)) {
			chunks.push({
				addr: w.addr,
				size: w.size,
				pragmas: {...w.pragmas},
				old: w.old ? Buffer.from(w.old) : null,
				new: Buffer.from(w.new),
			});
		} else {
			let prevChunk = chunks[chunks.length - 1];
			prevChunk.size += w.size;
			if (prevChunk.old)
				prevChunk.old = Buffer.concat([prevChunk.old, w.old]);
			prevChunk.new = Buffer.concat([prevChunk.new, w.new]);
		}
	}
	return chunks;
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

async function getFilesFromArchive(file) {
	return new Promise((resolve, reject) => {
		let proc = child_process.spawn("lsar", ["-j", file], { encoding: 'utf-8' });
		let json = "";
		proc.stdout.on('data', (chunk) => json += chunk);
		proc.on('error', (e) => reject(e));
		proc.on('close', (status) => {
			try {
				if (status != 0)
					throw new Error(`Invalid archive [status=${status}]: ${file}`);
				resolve(JSON.parse(json));
			} catch (e) {
				reject(e);
			}
			proc = json = null;
		});
	});
}

function extractFileFromArchive(file, index) {
	return new Promise((resolve, reject) => {
		let proc = child_process.spawn("unar", ["-i", "-o", "-", file, index]);
		let buffer = [];
		proc.stdout.on('data', (chunk) => buffer.push(chunk));
		proc.on('error', (e) => reject(e));
		proc.on('close', (status) => {
			try {
				if (status != 0)
					throw new Error(`Invalid archive [status=${status}]: ${file}`);
				resolve(Buffer.concat(buffer));
			} catch (e) {
				reject(e);
			}
			proc = buffer = null;
		});
	});
}
