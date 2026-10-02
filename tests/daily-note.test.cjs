const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const moment = require("moment");

const today = "2026-10-02T10:30:00";
const journalPath = "01 journals/2026/10-October/2026-10-02.md";
const periodicDaily = {
	enabled: true,
	folder: "01 journals",
	format: "YYYY/MM-MMMM/YYYY-MM-DD",
	template: "templates/Daily Journal",
};

// Run the built plugin and its bundled daily-notes library. Only the Obsidian
// host is replaced, so settings selection and template rendering are real.
function fixture({ daily = periodicDaily, core, files = {} } = {}) {
	class TFile {
		constructor(path, body) {
			this.path = path;
			this.body = body;
		}
	}
	const entries = new Map(Object.entries(files).map(([path, body]) => [path, new TFile(path, body)]));
	const folders = new Set();
	const created = [];
	const notices = [];
	const app = {
		plugins: { getPlugin: () => daily ? { settings: { daily } } : null },
		internalPlugins: { getPluginById: () => core ? { instance: { options: core } } : null },
		metadataCache: { getFirstLinkpathDest: (path) => entries.get(path.endsWith(".md") ? path : `${path}.md`) },
		foldManager: { load: () => null, save: () => {} },
		vault: {
			getFileByPath: (path) => entries.get(path) ?? null,
			getAbstractFileByPath: (path) => entries.get(path) ?? (folders.has(path) ? {} : null),
			createFolder: async (path) => { folders.add(path); },
			cachedRead: async (file) => file.body,
			create: async (path, body) => {
				assert.equal(entries.has(path), false, `Must not overwrite ${path}`);
				const file = new TFile(path, body);
				entries.set(path, file);
				created.push(file);
				return file;
			},
		},
	};
	const obsidian = {
		Plugin: class {},
		PluginSettingTab: class {},
		TFile,
		normalizePath: (path) => path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "") || "/",
		Notice: class { constructor(message) { notices.push(message); } },
	};
	const context = {
		module: { exports: {} },
		require: (id) => id === "obsidian" ? obsidian : require(id),
		window: { app, moment: (...args) => args.length ? moment(...args) : moment(today) },
		console,
		process,
	};
	vm.runInNewContext(readFileSync(new URL("../main.js", `file://${__filename}`), "utf8"), context);
	const plugin = Object.create(context.module.exports.default.prototype);
	plugin.app = app;
	return { plugin, entries, created, folders, notices };
}

test("Periodic Notes reuses the journal even with core Daily Notes disabled and a duplicate at root", async () => {
	const { plugin, entries, created } = fixture({ files: { [journalPath]: "Journal", "2026-10-02.md": "Duplicate" } });
	assert.equal(await plugin.resolveDailyNote(), entries.get(journalPath));
	assert.equal(created.length, 0);
});

test("Periodic Notes takes precedence over conflicting core settings", async () => {
	const { plugin } = fixture({ core: { folder: "Daily", format: "YYYY-MM-DD" }, files: { [journalPath]: "Journal" } });
	assert.equal((await plugin.resolveDailyNote()).path, journalPath);
});

test("Creating a periodic daily note uses nested folders and renders its template", async () => {
	const { plugin, folders, notices } = fixture({ files: { "templates/Daily Journal.md": "# {{date:YYYY-MM-DD}}\nCreated {{time}}" } });
	const file = await plugin.resolveDailyNote();
	assert.equal(file.path, journalPath);
	assert.equal(file.body, "# 2026-10-02\nCreated 10:30");
	assert.ok(folders.has("01 journals/2026/10-October"));
	assert.deepEqual(notices, []);
});

for (const daily of [null, { ...periodicDaily, enabled: false }]) {
	test(`Core Daily Notes still works when Periodic Notes is ${daily ? "disabled for daily notes" : "absent"}`, async () => {
		const path = "Daily/2026-10-02.md";
		const { plugin, entries } = fixture({ daily, core: { folder: "Daily", format: "YYYY-MM-DD" }, files: { [path]: "Core journal" } });
		assert.equal(await plugin.resolveDailyNote(), entries.get(path));
	});
}

test("An unconfigured vault creates a dated note at root", async () => {
	const { plugin, notices } = fixture({ daily: null });
	const file = await plugin.resolveDailyNote();
	assert.equal(file.path, "2026-10-02.md");
	assert.equal(file.body, "");
	assert.deepEqual(notices, []);
});
