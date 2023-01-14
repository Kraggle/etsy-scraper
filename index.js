// @ts-nocheck
// Install the Node ScrapingBee library
// npm install scrapingbee
const scrapingbee = require('scrapingbee'),
	jsonexport = require('jsonexport'),
	fs = require('fs'),
	CSV = require('csvtojson');
require('dotenv').config();

if (!process.env.APIKEY) {
	console.error('You need to setup your .env file with your APIKEY from ScrapingBee');
	process.exit();
}

const extract_rules = {
	"lastPage": "nav[role] ul li:nth-last-child(2) span:last-child",
	"items": {
		"selector": ".v2-listing-card",
		"type": "list",
		"output": {
			"title": "h3",
			"link": {
				"selector": ".listing-link",
				"output": "@href"
			},
			"image": {
				"selector": "img",
				"output": "@src"
			}
		}
	}
};

const extract = [[], []],
	pages = [],
	client = new scrapingbee.ScrapingBeeClient(process.env.APIKEY),
	imports = [[], []];

let pagesMade = false,
	lastPage = 10;

async function get(url) {
	const response = await client.get({
		url,
		params: {
			render_js: 'false',
			premium_proxy: 'true',
			extract_rules: extract_rules,
			country_code: 'gb',
		},
	});
	return response
}

const concurrent = 50,
	running = new Array(concurrent);

function useSlot() {
	for (let i = 0; i < concurrent; i++) {
		if (!running[i]) {
			running[i] = true;
			return true;
		}
	}
	return false;
}

function freeSlot() {
	for (let i = 0; i < concurrent; i++) {
		if (running[i]) {
			running[i] = false;
			return;
		}
	}
}

async function scrapeStore(store) {
	if (!extract[1].length) getCSVs(store);

	if (!pages.length && !pagesMade) {
		try {
			const json = JSON.parse(fs.readFileSync(`${store}.json`).toString());
			if (json[0] == 'finished') {
				console.log(`You have already completed the scrape of ${store}`);
				process.exit();
			}
			pages.push(...json);
			pagesMade = true;
		} catch (error) { }
	}

	function tryPage(page) {
		console.log(`working page ${page}`);

		get(`https://www.etsy.com/uk/shop/${store}/sold?ref=pagination&page=${page}`).then(async function(response) {

			let count = 0;
			for (let i = 0; i < extract.length; i++)
				count += extract[i].length;
			count = Math.round(count / 24) || 1

			const decoder = new TextDecoder(),
				res = JSON.parse(decoder.decode(response.data)),
				set = Math.ceil(count / 2000);

			lastPage = isNaN(res.lastPage) ? lastPage : res.lastPage;

			if (!extract[set]) extract[set] = [];
			extract[set].push(...res.items);

			if (!pagesMade) {
				for (let i = 2; i <= lastPage; i++)
					pages.push(i);
				savePage(store);
				pagesMade = true;
			}

			page % 10 == 0 && saveExtracted(store);

			freeSlot();
			for (let i = 0; i < concurrent; i++) {
				// await delay(50);
				scrapeStore(store);
			}
		}).catch(function(e) {
			// if (e.response.status != 429)
			// 	console.log('Something went wrong: ' + e.response.data)
			tryPage(page);
		});
	}

	if (useSlot()) {
		const n = await getNextPage(store);
		n && tryPage(n);
	}
}

let isSaving = false;
async function saveExtracted(store) {

	while (isSaving)
		await delay(50);

	let count = 0;
	for (let i = 0; i < extract.length; i++)
		count += extract[i].length;
	if (!count) return;
	count = Math.round(count / 24) || 1;

	isSaving = true;
	await saveCSV(store);
	console.log(`${count} of ${lastPage} (csv updated)`);
	isSaving = false;
}

function delay(time) {
	return new Promise(resolve => setTimeout(resolve, time));
}

async function getCSVs(store) {
	let page = 1;
	async function getCSV() {
		try {
			const json = await CSV().fromFile(`${store}-${page}.csv`);
			if (!extract[page]) extract[page] = [];
			// @ts-ignore
			if (!imports[page]) imports[page] = 0;
			extract[page].push(...json);
			imports[page] = json.length;
			// console.log(extract[page].length);
			page++;
			getCSV();
		} catch (error) {
			// console.error('CSV opening went wrong: ' + error);
		}
	}
	getCSV();
}

async function saveCSV(store) {
	savePage(store);

	for (let i = 0; i < extract.length; i++) {
		const set = extract[i];
		const len = imports[i];
		if (!set.length) continue;
		if (set.length == len) continue;
		imports[i] = set.length;
		const csv = await jsonexport(set);
		await fs.writeFileSync(`${store}-${i}.csv`, csv);
	}
}

async function savePage(store) {
	fs.writeFileSync(`${store}.json`, JSON.stringify(pages));
}

let aquiringPage = false;
async function getNextPage() {
	do {
		await delay(50);
	} while (aquiringPage);
	aquiringPage = true;
	const page = !pagesMade ? 1 : pages.shift();
	await delay(50);
	aquiringPage = false;
	return page;
}

function getArgs() {
	const args = {};
	for (let i = 0; i < process.argv.length; i++) {
		const key = process.argv[i],
			value = process.argv[i + 1];
		if (key.match(/^-\w+$/))
			args[key.replace(/^-/, '')] = value;
	}
	return args;
}

const args = getArgs(),
	vStore = args.store || args.s;

if (vStore)
	scrapeStore(vStore);
else {
	console.log('You need to set `-store "StoreNameExample" while calling this script');
	process.exit();
}

process.on('exit', async function() {
	await saveExtracted(vStore);
	fs.writeFileSync(`${vStore}.json`, JSON.stringify(['finished']));
	console.log('Finished!');
});
