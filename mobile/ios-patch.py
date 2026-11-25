# يضيف إعدادات الفحص بالخلفية والأيقونة لمشروع الايفون بعد إنشائه
import plistlib, re, shutil, glob, os
# رفع أقل إصدار iOS إلى 14 (مطلوب لإضافة الفحص بالخلفية)
pf = 'ios/App/Podfile'
t = open(pf).read(); t = re.sub(r"platform :ios, '[\d.]+'", "platform :ios, '14.0'", t); open(pf, 'w').write(t)
px = 'ios/App/App.xcodeproj/project.pbxproj'
t = open(px).read(); t = re.sub(r'IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;', 'IPHONEOS_DEPLOYMENT_TARGET = 14.0;', t); open(px, 'w').write(t)
p = 'ios/App/App/Info.plist'
with open(p, 'rb') as f: d = plistlib.load(f)
d['CFBundleDisplayName'] = 'مدير بصمة IBRA'
d['UIBackgroundModes'] = ['fetch', 'processing']
d['BGTaskSchedulerPermittedIdentifiers'] = ['com.ibraprogram.attendance.manager.check']
d['ITSAppUsesNonExemptEncryption'] = False
d['UIUserInterfaceStyle'] = 'Dark'
d['NSAppTransportSecurity'] = {'NSAllowsArbitraryLoads': False}
with open(p, 'wb') as f: plistlib.dump(d, f)

a = 'ios/App/App/AppDelegate.swift'
s = open(a).read()
if 'CapacitorBackgroundRunner' not in s:
    s = s.replace('import Capacitor', 'import Capacitor\nimport CapacitorBackgroundRunner', 1)
    s = re.sub(r'(didFinishLaunchingWithOptions[^{]*\{)', r'\1\n        BackgroundRunnerPlugin.registerBackgroundTask()\n        BackgroundRunnerPlugin.handleApplicationDidFinishLaunching(launchOptions: launchOptions)', s, count=1)
    open(a, 'w').write(s)

icons = glob.glob('ios/App/App/Assets.xcassets/AppIcon.appiconset/*.png')
for i in icons: shutil.copy('resources/icon-1024.png', i)
print('patched', len(icons), 'icon(s)')
print(s[:1200])
