
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

const extract = [],
	client = new scrapingbee.ScrapingBeeClient(process.env.APIKEY),
	args = getArgs(),
	store = args.store || args.s,
	dir = `./${store}`,
	pages = [];

let lastPage = 0;

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

function countFreeSlots() {
	let count = 0;
	for (let i = 0; i < running.length; i++)
		count += !running[i] ? 1 : 0;
	return count;
}

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

async function scrapeStore() {
	if (!fs.existsSync(dir))
		fs.mkdirSync(dir);

	if (!extract.length) await getCSVs();

	function tryPage(page) {
		// console.log(`working page ${page}`);

		get(`https://www.etsy.com/uk/shop/${store}/sold?ref=pagination&page=${page}`).then(async function(response) {

			const decoder = new TextDecoder(),
				res = JSON.parse(decoder.decode(response.data));

			lastPage = isNaN(res.lastPage) ? lastPage : res.lastPage;
			extract[page] = res.items;
			saveExtracted();

			freeSlot();
			const count = countFreeSlots();
			for (let i = 0; i < count; i++)
				scrapeStore();

			mergeCSVs();

		}).catch(function(e) {
			tryPage(page);
		});
	}

	if (useSlot()) {
		const n = !lastPage ? 1 : await getNextPage();
		n && tryPage(n);
	}
}

let isSaving = false;
async function saveExtracted() {

	while (isSaving)
		await delay(50);

	isSaving = true;
	await saveCSV();
	isSaving = false;
}

function delay(time) {
	return new Promise(resolve => setTimeout(resolve, time));
}

async function getCSVs() {
	let page = 1;
	async function getCSV() {
		try {
			extract[page] = await CSV().fromFile(`${dir}/${store}-${page}.csv`);
			pages[page] = true;
			page++;
			await getCSV();
		} catch (error) {
			// console.error('CSV opening went wrong: ' + error);
		}
	}
	await getCSV();
}

async function saveCSV() {
	for (let i = 1; i <= extract.length; i++) {
		const file = `${dir}/${store}-${i}.csv`;
		if (fs.existsSync(file)) continue;
		jsonexport(extract[i], (err, csv) => {
			fs.writeFileSync(file, csv);
			if (i % 10 == 0)
				console.log(`Saving page ${i} of ${lastPage}`);
		});
	}
}

async function savePage(store) {
	fs.writeFileSync(`${dir}/${store}.json`, JSON.stringify(pages));
}

let aquiringPage = false;
async function getNextPage() {
	do {
		await delay(50);
	} while (aquiringPage);
	aquiringPage = true;
	let page = 0;
	for (let i = 1; i <= lastPage; i++) {
		if (!pages[i]) {
			pages[i] = true;
			page = i;
			break;
		}
	}
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

if (store)
	scrapeStore();
else {
	console.log('You need to set `-store "StoreNameExample" while calling this script');
	process.exit();
}

let mergeActive = false;
async function mergeCSVs() {
	if (mergeActive) return;
	mergeActive = true;

	let files;
	do {
		await delay(500);
		files = fs.readdirSync(dir);
		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			if (!file.match(/-\d+.csv$/))
				files.splice(i, 1);
		}
	} while (!lastPage && files.length != lastPage);

	console.log('Merging all data!');
	await getCSVs();
	const all = [],
		file = `${dir}/${store}.csv`;

	for (let i = 1; i < extract.length; i++)
		all.push(...extract[i]);

	console.log(`Items sold: ${all.length}`);

	jsonexport(all, (err, csv) => {
		fs.writeFileSync(file, csv);
		console.log(`Merged data saved to ${file}`);
	});

	files.forEach(file => {
		fs.unlinkSync(`${dir}/${file}`);
	});

	process.exit();
}

process.on('exit', async function() {
	console.log('Finished!');
});
