// Install the Node ScrapingBee library
// npm install scrapingbee
const scrapingbee = require('scrapingbee'),
	jsonexport = require('jsonexport'),
	fs = require('fs'),
	CSV = require('csvtojson');


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
	client = new scrapingbee.ScrapingBeeClient('E4UKYNB41MYQW86FT38LJT6YJ38K7MHBKI9PCUH57Y9SFWY0IZAFEPDQ7BDIZO3WOI998PXYYT5RX47H');

let pagesMade = false;

async function get(url) {
	const response = await client.get({
		url: url,
		params: {
			render_js: 'false',
			premium_proxy: 'true',
			extract_rules: extract_rules,
			country_code: 'us',
		},
	});
	return response
}

const concurrent = 5,
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

	if (!pages.length) {
		try {
			const json = JSON.parse(fs.readFileSync(`${store}.json`).toString());
			pages.push(...json);
			pagesMade = true;
		} catch (error) { }
	}

	function tryPage(page) {
		// console.log(`working page ${page}`);

		get(`https://www.etsy.com/uk/shop/${store}/sold?ref=pagination&page=${page}`).then(async function(response) {

			let count = 0;
			for (let i = 0; i < extract.length; i++)
				count += extract[i].length;
			count = Math.round(count / 24)

			const decoder = new TextDecoder(),
				res = JSON.parse(decoder.decode(response.data)),
				set = Math.ceil(count / 2000);

			if (!extract[set]) extract[set] = [];
			extract[set].push(...res.items);

			if (!pagesMade) {
				for (let i = 2; i <= res.lastPage; i++)
					pages.push(i);
				savePage(store);
				pagesMade = true;
			}

			if (count % 10 == 0) {
				saveCSV(store);
				console.log(`${count} of ${res.lastPage} (csv updated)`);
			}

			if (page == res.lastPage) await saveCSV(store);
			else {
				freeSlot();
				for (let i = 0; i < concurrent; i++) {
					await delay(50);
					scrapeStore(store);
				}
			}
		}).catch(function(e) {
			// if (e.response.status != 429)
			// 	console.log('Something went wrong: ' + e.response.data)
			tryPage(page);
		});
	}

	if (useSlot()) {
		const n = getNextPage(store);
		n && tryPage(n);
	}
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
			extract[page].push(...json);
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
		if (!set.length) continue;
		const csv = await jsonexport(set);
		fs.writeFile(`${store}-${i}.csv`, csv, err => {
			// console.error(err);
		});
	}
}

async function savePage(store) {
	fs.writeFile(`${store}.json`, JSON.stringify(pages), err => {
		// console.error(err);
	});
}

function getNextPage(store) {
	const page = !pagesMade ? 1 : pages.shift();
	// savePage(store);
	return page;
}

scrapeStore('PaddingPaws');
