import crypto from 'node:crypto';
import iconv from 'iconv-lite';
import * as cheerio from 'cheerio';

const KIBAB_URL = 'https://patches.kibab.com';

export interface KibabPatch {
	id: number;
	title: string;
}

export interface KibabDeletedPatch {
	id: number;
	model: string;
}

export interface KibabPhoneModel {
    name: string;
    model: string;
    sw: string;
    modelId: number;
    swId: number;
}

export class KibabAPI {
    private readonly user: string;
    private readonly password: string;
    private readonly session: string;

    constructor(user: string, password: string) {
        this.user = user;
        this.password = password;
        this.session = crypto.createHash('md5').update(`v0:${user}:${password}`).digest("hex");
    }

    async getDeletedPatches(page: number = 0): Promise<KibabDeletedPatch[]> {
        const url = `/stat.php5?action=del_pat&p=${page}`;
        const response = await this.apiRequest(url);
        const html = iconv.decode(Buffer.from(response), 'win1251');

        const deletedPatchesIds: KibabDeletedPatch[] = [];
        const $ = cheerio.load(html);

        const ids = $('table.maintext td.patches:nth-child(1)');
        const models = $('table.maintext td.patches:nth-child(2)');

        if (ids.length != models.length)
            throw new Error(`Invalid response (url=${url}).`);

        for (let i = 0; i < ids.length; i++) {
            const patchId = +$(ids[i]).text().trim();
            const phoneModel = $(models[i]).text().trim();

            if (!phoneModel.match(/^([\w\d_-]+)$/))
                throw new Error(`Invalid model: ${phoneModel}`);

            deletedPatchesIds.push({id: patchId, model: phoneModel});
        }
        return deletedPatchesIds;
    }

    async getAllModels(): Promise<KibabPhoneModel[]> {
        const response = await this.apiRequest(`/patches/phonelist.php5?`);
        const html = iconv.decode(Buffer.from(response), 'win1251');

        const models: KibabPhoneModel[] = [];

        const $ = cheerio.load(html);
        for (const p of $('a[href*="=disp_patches"]')) {
            const linkTitle = $(p).text();
            const linkUrl = $(p).attr("href") ?? '';

            const phone = linkTitle.match(/\s([a-z0-9]+v\d+)/i)?.[1];
            const phModelId = +(linkUrl.match(/ph_model=(\d+)/)?.[1] ?? 0);
            const phSwId = +(linkUrl.match(/ph_sw=(\d+)/)?.[1] ?? 0);

            if (!phone || !phone.match(/^([\w\d_-]+)$/))
                throw new Error(`Invalid model: ${phone}`);

            const [model, sw] = phone.split('v');

            models.push({
                name:       phone,
                model:      model,
                sw:         sw,
                modelId:    phModelId,
                swId:       phSwId,
            });
        }

        if (!models.length) {
            console.error(html);
            throw new Error(`Can't get all models!`);
        }

        return models;
    }

    async getAllPatches(modelId: number, swId: number): Promise<KibabPatch[]> {
        const response = await this.apiRequest(`/patches/index.php5?ph_model=${modelId}&ph_sw=${swId}&action=disp_patches`);
        const html = iconv.decode(Buffer.from(response), 'win1251');

        const patches: KibabPatch[] = [];

        const $ = cheerio.load(html);
        for (const p of $('a[class*="patch_name"]')) {
            const linkTitle = $(p).text();
            const linkUrl = $(p).attr("href") ?? '';

            const id = linkUrl.match(/id=(\d+)/)?.[1];
			if (!id)
				throw new Error(`Invalid patch link: ${linkUrl}`);

            patches.push({
                id:     +id,
                title:  linkTitle.trim(),
            });
        }

        return patches;
    }

    async addToCart(patchesIds: number[]): Promise<number[]> {
        const form = new URLSearchParams();
        form.append('action', 'add_multiple');

        for (const id of patchesIds)
            form.append('stuff[]', id.toString());

        const html = await this.apiRequest(`/patches/cart.php5`, form);
        const okAdded: number[] = [];

        let m;
        const re = /Патч (\d+) добавлен ОК/sig;
        while ((m = re.exec(html)))
            okAdded.push(+m[1]);

        const reAlready = /Патч (\d+) уже есть в Корзине/sig;
        while ((m = reAlready.exec(html)))
            okAdded.push(+m[1]);

        const notAdded: number[] = [];
        for (const id of patchesIds) {
            if (!okAdded.includes(id))
                notAdded.push(id);
        }
        return notAdded;
    }

    async downloadCart(): Promise<Buffer> {
        return await this.apiRequest(`/patches/dn_zip.php5?action=down_cart`, undefined, true);
    }

    async clearCart(): Promise<void> {
        await this.apiRequest(`/patches/cart.php5?action=del_all`);
    }

    async apiRequest(url: string, form?: URLSearchParams, asBuffer?: boolean): Promise<any> {
        const requestOptions: RequestInit = {};
        if (form) {
            requestOptions.method = 'POST';
            requestOptions.body = form;
        }

        const req = fetch(`${KIBAB_URL}${url}`, {
            headers:        { Cookie: this.getCookies() },
            credentials:    "include",
            redirect:       "manual",
            ...requestOptions
        });

        if (asBuffer) {
            return await req
                .then((res) => res.arrayBuffer())
                .then((res) => Buffer.from(res));
        } else {
            return await req
                .then((res) => res.arrayBuffer())
                .then((res) => iconv.decode(Buffer.from(res), 'win1251'));
        }
    }

    getCookies(): string {
        return `PHPSESSID=${this.session}; login=${this.user}; password=${this.password}`;
    }
}
