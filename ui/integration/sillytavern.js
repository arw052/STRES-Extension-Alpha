"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSTContext = getSTContext;
function getSTContext() {
    var _a, _b, _c;
    try {
        return (_c = (_b = (_a = window.SillyTavern) === null || _a === void 0 ? void 0 : _a.getContext) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : null;
    }
    catch (_) {
        return null;
    }
}
