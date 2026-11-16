// Сборка файлов программы для установщика: dist/win/Polka (дальше — build/make-installer.sh)
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const ResEdit = require('resedit');
const ELECTRON_ZIP = process.argv[2];
const OUT = path.resolve(__dirname, '../dist/win/Polka');
fs.rmSync(path.dirname(OUT), { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
execSync(`unzip -q "${ELECTRON_ZIP}" -d "${OUT}"`);
fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, 'Polka.exe'));
fs.copyFileSync(path.join(__dirname, 'Licenses.txt'), path.join(OUT, 'Licenses.txt'));
fs.rmSync(path.join(OUT, 'resources/default_app.asar'), { force: true });
// лишние языки интерфейса Chromium
for (const f of fs.readdirSync(path.join(OUT, 'locales'))) if (!/^(ru|en-US)\.pak$/.test(f)) fs.rmSync(path.join(OUT, 'locales', f));
// приложение
const APP = path.join(OUT, 'resources/app');
fs.mkdirSync(APP, { recursive: true });
for (const f of fs.readdirSync(path.resolve(__dirname, '../dist/app'))) fs.copyFileSync(path.resolve(__dirname, '../dist/app', f), path.join(APP, f));
// иконка и сведения о версии в exe
const exePath = path.join(OUT, 'Polka.exe');
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const gid = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map((i) => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
const strings = { ProductName: 'Полка', FileDescription: 'Полка — читалка FB2 и EPUB', CompanyName: '', LegalCopyright: '', OriginalFilename: 'Polka.exe', InternalName: 'Polka' };
vi.setStringValues({ lang: 1033, codepage: 1200 }, strings);
const [v1, v2, v3] = require('../electron/package.json').version.split('.').map(Number);
vi.setFileVersion(v1, v2, v3, 0, 1033); vi.setProductVersion(v1, v2, v3, 0, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, { FileVersion: [v1, v2, v3].join('.'), ProductVersion: [v1, v2, v3].join('.') });
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
// предохранители Electron: exe нельзя запустить как Node.js, настроить через NODE_OPTIONS или подключить отладчик
(async () => {
  const { flipFuses, FuseVersion, FuseV1Options, getCurrentFuseWire } = await import('@electron/fuses');
  await flipFuses(exePath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
  });
  const wire = await getCurrentFuseWire(exePath);
  console.log('fuses:', JSON.stringify(wire));
  console.log('ok: dist/win/Polka');
})().catch((e) => { console.error('fuses failed', e); process.exit(1); });
