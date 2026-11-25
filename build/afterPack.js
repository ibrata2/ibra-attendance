// يضع أيقونة البرنامج ومعلومات الإصدار على ملف exe بدون الحاجة لـ wine
const fs = require('fs'), path = require('path'), ResEdit = require('resedit');
exports.default = async function (context) {
  if (context.electronPlatformName !== 'win32') return;
  const name = context.packager.appInfo.productFilename;
  const exe = path.join(context.appOutDir, (context.packager.platformSpecificBuildOptions.executableName || name) + '.exe');
  const data = fs.readFileSync(exe);
  const pe = ResEdit.NtExecutable.from(data, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(pe);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const gid = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map(i => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  if (vi) {
    const v = context.packager.appInfo.version.split('.').map(Number);
    vi.setFileVersion(v[0], v[1], v[2], 0); vi.setProductVersion(v[0], v[1], v[2], 0);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: 'IBRA Attendance', ProductName: 'IBRA Attendance', CompanyName: 'IBRAPROGRAM', LegalCopyright: '© IBRAPROGRAM', OriginalFilename: path.basename(exe), InternalName: 'IBRA Attendance' });
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
  console.log('  • icon + version set on', path.basename(exe));
};
