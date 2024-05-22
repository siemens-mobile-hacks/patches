import iconv from 'iconv-lite';
import fs from 'fs';
import path from 'path';
import { Blob } from "buffer";
import { globSync } from 'glob';
import { vkpParse, vkpDetectContent, vkpNormalize, vkpNormalizeWithRTF } from '@sie-js/vkp';
import child_process from 'child_process';

const PATCHES_DIR = path.resolve(`${import.meta.dirname}/../patches`);

let tables = {
	unknownContent: {
		title: 'Not a patch',
		description: 'The patch contains unknown content which can\'t be detected as VKP by heuristics.',
		patches: []
	},
	additionalIsBroken: {
		title: 'Archive with additional files is broken',
		description: 'Unarchiver is unable to open this archives.',
		patches: []
	},
	additionalNotFound: {
		title: 'Additional files are not found',
		description: 'The patch has additional files, but it isn\'t accessible.',
		patches: []
	},
	patchInArchive: {
		title: 'The patch is in the archive instead of a patch body',
		description: 'This is not always an error, some patches are too big.',
		patches: []
	},
	empty: {
		title: 'Empty patches',
		description: 'This is not always an error, some patches contain commented lines.',
		patches: []
	},
	rtf: {
		title: 'RTF patches',
		description: 'This is not an error, but the RTF format is legacy and less portable.',
		patches: []
	}
};

let badPatches = [];

for (let file of readFiles(PATCHES_DIR)) {
	if (!file.match(/\.vkp$/))
		continue;

	let patchText = vkpNormalize(fs.readFileSync(`${PATCHES_DIR}/${file}`));
	let patchUrl = patchText.match(/Details: (https?:\/\/.*?)$/m)[1];
	let patchId = patchText.match(/PatchID: (\d+)$/m)[1];
	let [, patchModel, patchTitleRU, patchTitleEN] = patchText.match(/^;(.*?)\n;(.*?)\n;(.*?)\n/si);
	let additionalFile;

	let patchInfo = {
		id: patchId,
		file,
		title: [patchTitleRU, patchTitleEN],
		model: patchModel,
	};

	if (patchText.match(/;!(к патчу прикреплён файл|There is a file attached to this patch), https?:\/\//i)) {
		[additionalFile] = globSync(`${PATCHES_DIR}/${patchModel}/${patchId}-*.{rar,zip}`);
		if (!additionalFile)
			tables.additionalNotFound.patches.push(patchInfo);
	}

	let detectedType = vkpDetectContent(patchText);
	if (detectedType == "DOWNLOAD_STUB") {
		if (!additionalFile)
			continue;

		let archive;
		try {
			archive = await getFilesFromArchive(additionalFile);
		} catch (e) { }

		if (!archive) {
			tables.additionalIsBroken.patches.push(patchInfo);
			continue;
		}

		let foundPatches = 0;
		for (let entry of archive.lsarContents) {
			if (entry.XADFileName.match(/\.vkp$/i)) {
				let subpatchInfo = {
					...patchInfo,
					file: `${additionalFile.replace(PATCHES_DIR + '/', '')} -> ${entry.XADFileName}`
				};
				let rawPatchText = await extractFileFromArchive(additionalFile, entry.XADIndex);
				if (rawPatchText.indexOf('{\\rtf1') >= 0)
					tables.rtf.patches.push(patchInfo);
				let patchText = await vkpNormalizeWithRTF(rawPatchText);
				subpatchInfo.errors = analyzePatch(patchText);
				if (subpatchInfo.errors.length > 0)
					badPatches.push(subpatchInfo);

				foundPatches++;
			}
		}

		if (foundPatches > 0)
			tables.patchInArchive.patches.push(patchInfo);
	} else if (detectedType == "EMPTY") {
		tables.empty.patches.push(patchInfo);
	} else if (detectedType == "PATCH") {
		patchInfo.errors = analyzePatch(patchText);
		if (patchInfo.errors.length > 0)
			badPatches.push(patchInfo);
	} else {
		tables.unknownContent.patches.push(patchInfo);
	}
}

let md = [];
if (badPatches.length > 0) {
	md.push(`### Patches with errors`);
	for (let p of badPatches) {
		md.push(`[${p.file}](https://patches.kibab.com/patches/details.php5?id=${p.id})`);
		md.push("");
		for (let err of p.errors) {
			md.push(err.title);
			md.push("```");
			md.push(err.code);
			md.push("```");
			md.push("");
		}
	}
	md.push("");
}

for (let table of Object.values(tables)) {
	if (!table.patches.length)
		continue;

	md.push(`### ${table.title}`);
	md.push(`${table.description}`);
	md.push("");
	md.push(`| ID | Model | PATCH |`);
	md.push(`|---|---|---|`);
	for (let p of table.patches) {
		md.push(`| ${p.id} | ${p.model} | [${p.title.join('<br>')}](https://patches.kibab.com/patches/details.php5?id=${p.id}) |`);
	}
	md.push();
	md.push();
}

if (!md.length) {
	md.push(`No errors! Good job!`);
}

console.log(md.join("\n"));

function analyzePatch(patchText) {
	let vkp = vkpParse(patchText, {
		allowEmptyOldData:	true,
		allowPlaceholders:	true,
	});

	let patchErrors = [];
	if (vkp.warnings.length || vkp.errors.length) {
		for (let warn of vkp.warnings) {
			patchErrors.push({
				title: `Warning: ${warn.message}`,
				code: warn.codeFrame(patchText)
			});
		}
		for (let err of vkp.errors) {
			patchErrors.push({
				title: `Error: ${err.message}`,
				code: err.codeFrame(patchText)
			});
		}
	}
	return patchErrors;
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
