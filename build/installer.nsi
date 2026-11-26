; مثبّت بصمة IBRA
Unicode true
ManifestDPIAware true
!define APPNAME "IBRA Attendance"
!define ARNAME "بصمة IBRA"
!define EXE "IBRA-Attendance.exe"
!ifndef VERSION
!define VERSION "1.0.6"
!endif
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\IBRAAttendance"
Name "${ARNAME}"
OutFile "..\dist\IBRA-Attendance-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\IBRA Attendance"
InstallDirRegKey HKCU "Software\IBRAAttendance" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "IBRAPROGRAM — ابراهيم الخزرجي"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "CompanyName" "IBRAPROGRAM"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "© IBRAPROGRAM"

!include "MUI2.nsh"
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "تشغيل بصمة IBRA الآن"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Arabic"

Section "Install"
  ; إغلاق النسخة الشغالة قبل التحديث
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  Sleep 800
  SetOutPath "$INSTDIR"
  File /r "..\dist\win-unpacked\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\${ARNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateDirectory "$SMPROGRAMS\${ARNAME}"
  CreateShortCut "$SMPROGRAMS\${ARNAME}\${ARNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortCut "$SMPROGRAMS\${ARNAME}\إزالة البرنامج.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\IBRAAttendance" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${ARNAME} (${APPNAME})"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "IBRAPROGRAM - ابراهيم الخزرجي"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${REGKEY}" "URLInfoAbout" "https://ibraprogram.netlify.app/"
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
SectionEnd

Function .onInstSuccess
  ; بعد التحديث الصامت يرجع البرنامج يشتغل تلقائياً
  IfSilent 0 +2
  Exec '"$INSTDIR\${EXE}"'
FunctionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  Sleep 800
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.ibraprogram.attendance"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.IBRA Attendance"
  Delete "$DESKTOP\${ARNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${ARNAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${REGKEY}"
  DeleteRegKey HKCU "Software\IBRAAttendance"
  ; بيانات الموظفين والبصمات تبقى محفوظة في AppData حتى لا تضيع عند التحديث
SectionEnd
