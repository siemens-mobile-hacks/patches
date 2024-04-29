import iconv from 'iconv-lite';
import cheerio from 'cheerio';
import crypto from 'crypto';

const KIBAB_URL = 'https://patches.kibab.com';

class KibabAPI {
	user;
	password;
	session;

	constructor(user, password) {
		this.user = user;
		this.password = password;
		this.session = crypto.createHash('md5').update(`v0:${user}:${password}`).digest("hex")
	}

	async getDeletedPatches(page = 0) {
		let url = `/stat.php5?action=del_pat&p=${page}`;
		let html = await this.apiRequest(url);
		html = iconv.decode(Buffer.from(html), 'win1251');

		let deletedPatchesIds = [];
		let $ = cheerio.load(html);

		let ids = $('table.maintext td.patches:nth-child(1)');
		let models = $('table.maintext td.patches:nth-child(2)');

		if (ids.length != models.length)
			throw new Error(`Invalid response (url=${url}).`);

		for (let i = 0; i < ids.length; i++) {
			let patchId = +$(ids[i]).text().trim();
			let phoneModel = $(models[i]).text().trim();

			deletedPatchesIds.push({id: patchId, model: phoneModel});
		}
		return deletedPatchesIds;
	}

	async getAllModels() {
		let html = await this.apiRequest(`/patches/phonelist.php5?`);
		html = iconv.decode(Buffer.from(html), 'win1251');

		let models = [];

		let $ = cheerio.load(html);
		for (let p of $('a[href*="=disp_patches"]')) {
			let linkTitle = $(p).text();
			let linkUrl = $(p).attr("href");

			let phone = linkTitle.match(/\s([a-z0-9]+v\d+)/i)?.[1];
			let phModelId = linkUrl.match(/ph_model=(\d+)/)[1];
			let phSwId = linkUrl.match(/ph_sw=(\d+)/)[1];

			let [model, sw] = phone.split('v');

			models.push({
				name:		phone,
				model:		model,
				sw:			sw,
				modelId:	phModelId,
				swId:		phSwId,
			});
		}

		if (!models.length) {
			console.error(html);
			throw new Error(`Can't get all models!`);
		}

		return models;
	}

	async getAllPatches(modelId, swId) {
		let html = await this.apiRequest(`/patches/index.php5?ph_model=${modelId}&ph_sw=${swId}&action=disp_patches`);
		html = iconv.decode(Buffer.from(html), 'win1251');

		let patches = [];

		let $ = cheerio.load(html);
		for (let p of $('a[class*="patch_name"]')) {
			let linkTitle = $(p).text();
			let linkUrl = $(p).attr("href");

			let id = linkUrl.match(/id=(\d+)/)[1];

			patches.push({
				id:		id,
				title:	linkTitle.trim(),
			});
		}

		return patches;
	}

	async addToCart(patchesIds) {
		let form = new URLSearchParams();
		form.append('action', 'add_multiple');

		for (let id of patchesIds)
			form.append('stuff[]', id);

		let html = await this.apiRequest(`/patches/cart.php5`, form);
		let okAdded = [];

		let m;
		let re = /Патч (\d+) добавлен ОК/sig;
		while ((m = re.exec(html)))
			okAdded.push(m[1]);

		re = /Патч (\d+) уже есть в Корзине/sig;
		while ((m = re.exec(html)))
			okAdded.push(m[1]);

		let notAdded = [];
		for (let id of patchesIds) {
			if (!okAdded.includes(id))
				notAdded.push(id);
		}
		return notAdded;
	}

	async downloadCart() {
		return await this.apiRequest(`/patches/dn_zip.php5?action=down_cart`, null, true);
	}

	async clearCart() {
		await this.apiRequest(`/patches/cart.php5?action=del_all`);
	}

	async apiRequest(url, form, asBuffer) {
		let requestOptions = {};
		if (form) {
			requestOptions.method = 'POST';
			requestOptions.body = form;
		}

		let req = fetch(`${KIBAB_URL}${url}`, {
			headers:		{ Cookie: this.getCookies() },
			credentials:	"include",
			redirect:		"manual",
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

	async getSession() {

	}

	getCookies() {
		return `PHPSESSID=${this.session}; login=${this.user}; password=${this.password}`;
	}
};

export { KibabAPI };
