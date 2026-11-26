# يضيف إعدادات الفحص بالخلفية والأيقونة لمشروع الايفون بعد إنشائه
import plistlib, re, shutil, glob, os
# أقل إصدار iOS 14
pf = 'ios/App/Podfile'
t = open(pf).read(); t = re.sub(r"platform :ios, '[\d.]+'", "platform :ios, '14.0'", t); open(pf, 'w').write(t)
px = 'ios/App/App.xcodeproj/project.pbxproj'
t = open(px).read(); t = re.sub(r'IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;', 'IPHONEOS_DEPLOYMENT_TARGET = 14.0;', t); open(px, 'w').write(t)
p = 'ios/App/App/Info.plist'
with open(p, 'rb') as f: d = plistlib.load(f)
d['CFBundleDisplayName'] = 'مدير بصمة IBRA'
d['CFBundleShortVersionString'] = '1.0.4'
d['CFBundleVersion'] = '5'
d['ITSAppUsesNonExemptEncryption'] = False
d['NSCameraUsageDescription'] = 'الكاميرا تستخدم لمسح رمز ربط برنامج البصمة'
d['NSPhotoLibraryUsageDescription'] = 'لاختيار صورة رمز الربط'
d['UIUserInterfaceStyle'] = 'Dark'
d['NSAppTransportSecurity'] = {'NSAllowsArbitraryLoads': False}
with open(p, 'wb') as f: plistlib.dump(d, f)

icons = glob.glob('ios/App/App/Assets.xcassets/AppIcon.appiconset/*.png')
for i in icons: shutil.copy('resources/icon-1024.png', i)
print('patched', len(icons), 'icon(s)')
