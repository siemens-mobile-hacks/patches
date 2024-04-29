import iconv from 'iconv-lite';
import cheerio from 'cheerio';
import crypto from 'crypto';
import { promisify } from 'util';

const KIBAB_URL = 'https://patches.kibab.com';

class KibabAPI {
	constructor(user, password) {
		this.user = user;
		this.password = password;
		this.session = crypto.createHash('md5').update(`v0:${user}:${password}`).digest("hex")
	}

	async getAllModels() {
		let html = await this.apiRequest(`/patches/phonelist.php5?`);
		html = iconv.decode(Buffer.from(html), 'win1251');

		let models = [];

		let $ = cheerio.load(html);
		for (let p of $('a[href*="=disp_patches"]')) {
			let link_title = $(p).text();
			let link_url = $(p).attr("href");

			let phone = link_title.match(/\s([a-z0-9]+v\d+)/i)?.[1];
			let ph_model_id = link_url.match(/ph_model=(\d+)/)[1];
			let ph_sw_id = link_url.match(/ph_sw=(\d+)/)[1];

			let [model, sw] = phone.split('v');

			models.push({
				name:		phone,
				model:		model,
				sw:			sw,
				modelId:	ph_model_id,
				swId:		ph_sw_id,
			});
		}

		if (!models.length) {
			console.error(html);
			throw new Error(`Can't get all models!`);
		}

		return models;
	}

	async getAllPatches(model_id, sw_id) {
		let html = await this.apiRequest(`/patches/index.php5?ph_model=${model_id}&ph_sw=${sw_id}&action=disp_patches`);
		html = iconv.decode(Buffer.from(html), 'win1251');

		let patches = [];

		let $ = cheerio.load(html);
		for (let p of $('a[class*="patch_name"]')) {
			let link_title = $(p).text();
			let link_url = $(p).attr("href");

			let id = link_url.match(/id=(\d+)/)[1];

			patches.push({
				id:		id,
				title:	link_title.trim(),
			});
		}

		return patches;
	}

	async addToCart(patches_ids) {
		let form = new URLSearchParams();
		form.append('action', 'add_multiple');

		for (let id of patches_ids)
			form.append('stuff[]', id);

		let html = await this.apiRequest(`/patches/cart.php5`, form);
		let ok_added = [];

		let m;
		let re = /Патч (\d+) добавлен ОК/sig;
		while ((m = re.exec(html)))
			ok_added.push(m[1]);

		re = /Патч (\d+) уже есть в Корзине/sig;
		while ((m = re.exec(html)))
			ok_added.push(m[1]);

		let not_added = [];
		for (let id of patches_ids) {
			if (!ok_added.includes(id))
				not_added.push(id);
		}
		return not_added;
	}

	async downloadCart() {
		return await this.apiRequest(`/patches/dn_zip.php5?action=down_cart`, null, true);
	}

	async clearCart() {
		await this.apiRequest(`/patches/cart.php5?action=del_all`);
	}

	async apiRequest(url, form, as_buffer) {
		let request_options = {};
		if (form) {
			request_options.method = 'POST';
			request_options.body = form;
		}

		let req = fetch(`${KIBAB_URL}${url}`, {
			headers:		{ Cookie: this.getCookies() },
			credentials:	"include",
			redirect:		"manual",
			...request_options
		});

		if (as_buffer) {
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
