Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
Name "Frameinsight"
OutFile "output/Window_setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Frameinsight"
InstallDirRegKey HKCU "Software\Frameinsight" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ICON "frameinsight.ico"
!define MUI_UNICON "frameinsight.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install Frameinsight"
!define MUI_WELCOMEPAGE_TEXT "Annotate people in videos with editable interpolation.$\r$\n$\r$\nEverything needed is included. No Python, Node, GPU setup or internet connection is required.$\r$\n$\r$\nWindows 11 (64-bit). Your saved projects stay separate from the app."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Frameinsight.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open Frameinsight"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
VIProductVersion "1.8.0.0"
VIAddVersionKey /LANG=1033 "ProductName" "Frameinsight"
VIAddVersionKey /LANG=1033 "FileDescription" "Frameinsight offline annotation installer"
VIAddVersionKey /LANG=1033 "FileVersion" "1.8.0"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Frameinsight project"
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Frameinsight requires 64-bit Windows 11."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "Frameinsight requires Windows 11."
    Abort
  ${EndIf}
  System::Call 'kernel32::OpenMutexW(i 0x100000, i 0, w "Local\Frameinsight.Desktop.v1") p.r0'
  ${If} $0 != 0
    System::Call 'kernel32::CloseHandle(p r0)'
    MessageBox MB_ICONEXCLAMATION "Close Frameinsight from its taskbar tray icon, then run this installer again. Your projects will be kept."
    Abort
  ${EndIf}
FunctionEnd
Section "Frameinsight"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "payload/*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Frameinsight"
  CreateShortcut "$SMPROGRAMS\Frameinsight\Frameinsight.lnk" "$INSTDIR\Frameinsight.exe"
  CreateShortcut "$DESKTOP\Frameinsight.lnk" "$INSTDIR\Frameinsight.exe"
  WriteRegStr HKCU "Software\Frameinsight" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Frameinsight" "DisplayName" "Frameinsight"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Frameinsight" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Frameinsight" "DisplayVersion" "1.8.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Frameinsight" "DisplayIcon" "$INSTDIR\Frameinsight.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Frameinsight" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Frameinsight" "NoRepair" 1
SectionEnd
Function un.onInit
  System::Call 'kernel32::OpenMutexW(i 0x100000, i 0, w "Local\Frameinsight.Desktop.v1") p.r0'
  ${If} $0 != 0
    System::Call 'kernel32::CloseHandle(p r0)'
    MessageBox MB_ICONEXCLAMATION "Close Frameinsight from its taskbar tray icon before uninstalling."
    Abort
  ${EndIf}
FunctionEnd
Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\Frameinsight.lnk"
  Delete "$SMPROGRAMS\Frameinsight\Frameinsight.lnk"
  RMDir "$SMPROGRAMS\Frameinsight"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\licenses"
  Delete "$INSTDIR\Frameinsight.exe"
  Delete "$INSTDIR\START-HERE.txt"
  Delete "$INSTDIR\build-manifest.json"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Frameinsight"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Frameinsight"
  ; Deliberately preserve $LOCALAPPDATA\Frameinsight (all user data).
SectionEnd
