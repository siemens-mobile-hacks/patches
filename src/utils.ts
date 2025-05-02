import fs from "node:fs";
import crypto from "node:crypto";

interface WgetResponse {
	status: number;
	body: Buffer;
}

export function findZipStart(blob: Buffer): number {
	let foundZipStart = -1;
	for (let i = 0; i < blob.length; i++) {
		if (blob[i] == 0x50 && blob[i + 1] == 0x4b && blob[i + 2] == 0x03 && blob[i + 3] == 0x04) {
			foundZipStart = i;
			break;
		}
	}
	return foundZipStart;
}

export function fileMD5(file: string): string {
	return crypto.createHash('md5').update(fs.readFileSync(file)).digest("hex");
}

export function getChunks<T>(arr: T[], size: number): T[][] {
	const chunks: T[][] = [];
	while (arr.length > 0) {
		const chunk: T[] = [];
		while (chunk.length < size && arr.length > 0)
			chunk.push(arr.shift()!);
		chunks.push(chunk);
	}
	return chunks;
}

export async function wget(url: string): Promise<WgetResponse> {
	const response = await fetch(url);
	return {
		status:	response.status,
		body: Buffer.from(await response.arrayBuffer())
	};
}

export function readFiles(dir: string, base: string = "", files: string[] = []): string[] {
	fs.readdirSync(dir, {withFileTypes: true}).forEach((entry) => {
		if (entry.isDirectory()) {
			readFiles(dir + "/" + entry.name, base + entry.name + "/", files);
		} else {
			files.push(base + entry.name);
		}
	});
	return files;
}
