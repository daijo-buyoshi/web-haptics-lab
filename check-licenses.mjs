import fs from "fs";
import path from "path";

const rootDir = path.resolve("public/models");

function walk(dir, list = []) {
    if (!fs.existsSync(dir)) return list;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, list);
        else if (/\.(gltf|glb)$/i.test(entry.name)) list.push(full);
    }
    return list;
}

function readGltfJson(filePath) {
    if (filePath.toLowerCase().endsWith(".gltf")) {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
    const buf = fs.readFileSync(filePath);
    if (buf.toString("utf8", 0, 4) !== "glTF") return null;
    const jsonLen = buf.readUInt32LE(12);
    const jsonText = buf.toString("utf8", 20, 20 + jsonLen);
    return JSON.parse(jsonText);
}

for (const file of walk(rootDir).sort()) {
    const rel = path.relative(rootDir, file);
    try {
        const json = readGltfJson(file);
        const ex = json?.asset?.extras || {};
        const licTxt = path.join(path.dirname(file), "license.txt");
        const hasTxt = fs.existsSync(licTxt);

        console.log("========================================");
        console.log("FILE   :", rel);
        console.log("TITLE  :", ex.title || "(記載なし)");
        console.log("AUTHOR :", ex.author || "(記載なし)");
        console.log("LICENSE:", ex.license || (hasTxt ? "license.txtあり" : "(記載なし)"));
        console.log("SOURCE :", ex.source || "(記載なし)");
    } catch (e) {
        console.log("ERROR  :", rel, e.message);
    }
}