import fs from 'node:fs';
import path from 'node:path';
import child_process from 'node:child_process';
import { globSync } from 'glob';
import { vkpParse, vkpDetectContent, vkpNormalize, vkpNormalizeWithRTF } from '@sie-js/vkp';
import { readFiles } from "./utils.js";

const PATCHES_DIR = path.resolve(`${import.meta.dirname}/../patches`);

interface PatchInfo {
	id: number;
	file: string;
	title: string[];
	model: string;
	errors?: PatchError[];
}

interface PatchError {
	title: string;
	code: string;
}

interface Table {
	title: string;
	description: string;
	patches: PatchInfo[];
}

interface ArchiveEntry {
	XADFileName: string;
	XADIndex: number;
}

interface ArchiveContents {
	lsarContents: ArchiveEntry[];
}

const tables: Record<string, Table> = {
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

const badPatches: PatchInfo[] = [];

for (const file of readFiles(PATCHES_DIR)) {
	if (!file.match(/\.vkp$/))
		continue;

	const patchText = vkpNormalize(fs.readFileSync(`${PATCHES_DIR}/${file}`));
	const patchId = parseInt(patchText.match(/PatchID: (\d+)$/m)?.[1] ?? '');
	const [, patchModel, patchTitleRU, patchTitleEN] = patchText.match(/^;(.*?)\n;(.*?)\n;(.*?)\n/si) ?? [undefined, '', '', ''];
	let additionalFile: string | undefined;

	const patchInfo: PatchInfo = {
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

	const detectedType = vkpDetectContent(patchText);
	if (detectedType == "DOWNLOAD_STUB") {
		if (!additionalFile)
			continue;

		let archive: ArchiveContents | undefined;
		try {
			archive = await getFilesFromArchive(additionalFile);
		} catch (e) { }

		if (!archive) {
			tables.additionalIsBroken.patches.push(patchInfo);
			continue;
		}

		let foundPatches = 0;
		for (const entry of archive.lsarContents) {
			if (entry.XADFileName.match(/\.vkp$/i)) {
				const subpatchInfo: PatchInfo = {
					...patchInfo,
					file: `${additionalFile.replace(PATCHES_DIR + '/', '')} -> ${entry.XADFileName}`
				};
				const rawPatchText = await extractFileFromArchive(additionalFile, entry.XADIndex);
				if (rawPatchText.indexOf('{\\rtf1') >= 0)
					tables.rtf.patches.push(patchInfo);
				const normalizedPatchText = await vkpNormalizeWithRTF(rawPatchText);
				subpatchInfo.errors = analyzePatch(normalizedPatchText);
				if (subpatchInfo.errors && subpatchInfo.errors.length > 0)
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
		if (patchInfo.errors && patchInfo.errors.length > 0)
			badPatches.push(patchInfo);
	} else {
		tables.unknownContent.patches.push(patchInfo);
	}
}

const md: string[] = [];
if (badPatches.length > 0) {
	md.push(`### Patches with errors`);
	for (const p of badPatches) {
		md.push(`[${p.file}](https://patches.kibab.com/patches/details.php5?id=${p.id})`);
		md.push("");
		if (p.errors) {
			for (const err of p.errors) {
				md.push(err.title);
				md.push("```");
				md.push(err.code);
				md.push("```");
				md.push("");
			}
		}
	}
	md.push("");
}

for (const table of Object.values(tables)) {
	if (!table.patches.length)
		continue;

	md.push(`### ${table.title}`);
	md.push(`${table.description}`);
	md.push("");
	md.push(`| ID | Model | PATCH |`);
	md.push(`|---|---|---|`);
	for (const p of table.patches) {
		md.push(`| ${p.id} | ${p.model} | [${p.title.join('<br>')}](https://patches.kibab.com/patches/details.php5?id=${p.id}) |`);
	}
	md.push("");
	md.push("");
}

if (!md.length) {
	md.push(`No errors! Good job!`);
}

console.log(md.join("\n"));

function analyzePatch(patchText: string): PatchError[] {
	const vkp = vkpParse(patchText, {
		allowEmptyOldData: true,
		allowPlaceholders: true,
	});

	const patchErrors: PatchError[] = [];
	if (vkp.warnings.length || vkp.errors.length) {
		for (const warn of vkp.warnings) {
			patchErrors.push({
				title: `Warning: ${warn.message}`,
				code: warn.codeFrame(patchText)
			});
		}
		for (const err of vkp.errors) {
			patchErrors.push({
				title: `Error: ${err.message}`,
				code: err.codeFrame(patchText)
			});
		}
	}
	return patchErrors;
}

async function getFilesFromArchive(file: string): Promise<ArchiveContents> {
	return new Promise((resolve, reject) => {
		const proc = child_process.spawn("lsar", ["-j", file]);
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
		});
	});
}

function extractFileFromArchive(file: string, index: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const proc = child_process.spawn("unar", ["-i", "-o", "-", file, index.toString()]);
		const buffer: Buffer[] = [];
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
		});
	});
}
