const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

function fixture() {
	const context = {
		module: { exports: {} },
		require: (id) => id === "obsidian" ? { Plugin: class {}, PluginSettingTab: class {} } : require(id),
		window: { setTimeout, clearTimeout },
		console,
		process,
	};
	vm.runInNewContext(readFileSync(new URL("../main.js", `file://${__filename}`), "utf8"), context);
	const plugin = Object.create(context.module.exports.default.prototype);
	const state = { activeApp: "t3code", focused: false, editorFocused: false, shown: 0, loaded: 0 };
	const leaf = {};
	plugin.app = { workspace: { layoutReady: true, setActiveLeaf: (target, options) => {
		assert.equal(target, leaf);
		assert.equal(options.focus, true);
		state.editorFocused = true;
	} } };
	plugin.captureWindow = {};
	plugin.hostLeaf = () => leaf;
	plugin.focusReleaseTimer = null;
	plugin.popoutHidden = true;
	plugin.settings = { opacity: 1, reapplyOnShow: true };
	plugin.applyCapture = async () => { state.loaded++; };
	plugin.markContentViewAsNavigation = () => {};
	plugin.rememberPreviousApp = async () => { plugin.previousApp = state.activeApp; };
	plugin.popoutBW = {
		isDestroyed: () => false,
		setFocusable: () => {},
		setOpacity: () => {},
		setIgnoreMouseEvents: () => {},
		setSkipTaskbar: () => {},
		// Model the observed macOS distinction: focus alone does not activate
		// a background app, while show activates it and focuses this window.
		focus: () => { state.focused = state.activeApp === "obsidian"; },
		show: () => { state.activeApp = "obsidian"; state.focused = true; state.shown++; },
	};
	return { plugin, state };
}

test("The toggle activates the floating window and focuses its editor from another app", async () => {
	const { plugin, state } = fixture();
	await plugin.toggleCapture();
	assert.equal(plugin.popoutHidden, false);
	assert.equal(state.focused, true);
	assert.equal(state.editorFocused, true);
	assert.equal(state.loaded, 1);
	assert.equal(plugin.previousApp, "t3code");
});

test("The toggle waits for the previous-app snapshot before loading or activating the window", async () => {
	const { plugin, state } = fixture();
	let finishSnapshot;
	plugin.rememberPreviousApp = () => new Promise(resolve => {
		finishSnapshot = () => { plugin.previousApp = state.activeApp; resolve(); };
	});
	const opening = plugin.toggleCapture();
	assert.equal(state.shown, 0);
	assert.equal(state.loaded, 0);
	finishSnapshot();
	await opening;
	assert.equal(plugin.previousApp, "t3code");
	assert.equal(state.focused, true);
});

test("Finishing an open after the popout was hidden does not steal focus back", () => {
	const { plugin, state } = fixture();
	plugin.focusPopout();
	assert.equal(state.shown, 0);
	assert.equal(state.editorFocused, false);
});
