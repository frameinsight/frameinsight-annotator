#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <stdio.h>
#include <wchar.h>
#define TRAY_MSG (WM_APP+1)
#define OPEN_MSG (WM_APP+2)
static HANDLE child=NULL, stopEvent=NULL, readyEvent=NULL;
static NOTIFYICONDATAW tray;
static BOOL started=FALSE, stopping=FALSE;
static DWORD launchTime;
static WCHAR dataDir[MAX_PATH];
static const WCHAR *className=L"Frameinsight.Desktop.v1";
static void openEditor(void){
    if(started&&!stopping) ShellExecuteW(NULL,L"open",L"http://127.0.0.1:8765/",NULL,NULL,SW_SHOWNORMAL);
}
static void status(const WCHAR *text){
    lstrcpynW(tray.szTip,text,128); Shell_NotifyIconW(NIM_MODIFY,&tray);
}
static LRESULT CALLBACK windowProc(HWND hwnd,UINT msg,WPARAM wp,LPARAM lp){
    if(msg==OPEN_MSG){openEditor();return 0;}
    if(msg==TRAY_MSG){
        if(lp==WM_LBUTTONUP||lp==WM_LBUTTONDBLCLK) openEditor();
        if(lp==WM_RBUTTONUP){
            POINT point;GetCursorPos(&point);HMENU menu=CreatePopupMenu();
            AppendMenuW(menu,MF_STRING,1,L"Open Frameinsight");
            AppendMenuW(menu,MF_STRING,2,L"Open project data folder");
            AppendMenuW(menu,MF_SEPARATOR,0,NULL);
            AppendMenuW(menu,MF_STRING,3,L"Exit Frameinsight");
            SetForegroundWindow(hwnd);
            int selected=TrackPopupMenu(menu,TPM_RETURNCMD|TPM_RIGHTBUTTON,point.x,point.y,0,hwnd,NULL);
            DestroyMenu(menu);PostMessageW(hwnd,WM_NULL,0,0);
            if(selected==1)openEditor();
            if(selected==2)ShellExecuteW(NULL,L"open",dataDir,NULL,NULL,SW_SHOWNORMAL);
            if(selected==3&&!stopping&&MessageBoxW(hwnd,L"Finish saving in the browser before exiting.\n\nClose Frameinsight? Your saved projects will stay on this computer.",L"Frameinsight",MB_YESNO|MB_ICONQUESTION)==IDYES){
                stopping=TRUE;SetEvent(stopEvent);status(L"Frameinsight - finishing and closing");
            }
        }
        return 0;
    }
    if(msg==WM_TIMER){
        DWORD code=0;
        if(GetExitCodeProcess(child,&code)&&code!=STILL_ACTIVE){
            if(!stopping){
                WCHAR error[1000];swprintf(error,1000,L"Frameinsight could not keep running (code %lu).\n\nIf another app is using port 8765, close it and try again.\nDetails: %ls\\Logs\\server.log\n\nYour saved annotations are unchanged.",code,dataDir);
                MessageBoxW(hwnd,error,L"Frameinsight",MB_OK|MB_ICONERROR);
            }
            DestroyWindow(hwnd);return 0;
        }
        if(!started&&!stopping&&WaitForSingleObject(readyEvent,0)==WAIT_OBJECT_0){
            started=TRUE;status(L"Frameinsight - click to open, right-click to exit");openEditor();
        }
        if(!started&&!stopping&&GetTickCount()-launchTime>120000){
            stopping=TRUE;SetEvent(stopEvent);
            MessageBoxW(hwnd,L"Startup is taking too long. Close and reopen Frameinsight. Details are in the Logs folder inside your project data folder.",L"Frameinsight",MB_OK|MB_ICONERROR);
        }
        return 0;
    }
    if(msg==WM_CLOSE){stopping=TRUE;SetEvent(stopEvent);status(L"Frameinsight - finishing and closing");return 0;}
    if(msg==WM_QUERYENDSESSION){SetEvent(stopEvent);return TRUE;}
    if(msg==WM_DESTROY){Shell_NotifyIconW(NIM_DELETE,&tray);PostQuitMessage(0);return 0;}
    return DefWindowProcW(hwnd,msg,wp,lp);
}
int WINAPI wWinMain(HINSTANCE instance,HINSTANCE previous,LPWSTR cmd,int show){
    HANDLE mutex=CreateMutexW(NULL,FALSE,L"Local\\Frameinsight.Desktop.v1");
    if(!mutex)return 1;
    if(GetLastError()==ERROR_ALREADY_EXISTS){
        HWND existing=FindWindowW(className,NULL);
        if(existing)PostMessageW(existing,OPEN_MSG,0,0);
        CloseHandle(mutex);return 0;
    }
    WCHAR root[MAX_PATH],python[MAX_PATH],script[MAX_PATH],command[3*MAX_PATH];
    GetModuleFileNameW(NULL,root,MAX_PATH);WCHAR *slash=wcsrchr(root,L'\\');if(!slash)return 1;*slash=0;
    swprintf(python,MAX_PATH,L"%ls\\runtime\\pythonw.exe",root);
    swprintf(script,MAX_PATH,L"%ls\\app\\windows_server.py",root);
    WCHAR local[MAX_PATH];SHGetFolderPathW(NULL,CSIDL_LOCAL_APPDATA,NULL,0,local);
    swprintf(dataDir,MAX_PATH,L"%ls\\Frameinsight",local);
    readyEvent=CreateEventW(NULL,TRUE,FALSE,L"Local\\Frameinsight.Ready.v1");
    stopEvent=CreateEventW(NULL,TRUE,FALSE,L"Local\\Frameinsight.Stop.v1");
    if(!readyEvent||!stopEvent){MessageBoxW(NULL,L"Unable to create the local app session.",L"Frameinsight",MB_OK|MB_ICONERROR);return 1;}
    ResetEvent(readyEvent);ResetEvent(stopEvent);
    swprintf(command,3*MAX_PATH,L"\"%ls\" \"%ls\" --parent %lu",python,script,GetCurrentProcessId());
    STARTUPINFOW si={.cb=sizeof(si)};PROCESS_INFORMATION pi={0};
    if(!CreateProcessW(python,command,NULL,NULL,FALSE,CREATE_NO_WINDOW,NULL,root,&si,&pi)){
        MessageBoxW(NULL,L"Unable to start the bundled runtime. Reinstall Frameinsight; your project data will be kept.",L"Frameinsight",MB_OK|MB_ICONERROR);return 1;
    }
    child=pi.hProcess;CloseHandle(pi.hThread);launchTime=GetTickCount();
    WNDCLASSW wc={0};wc.lpfnWndProc=windowProc;wc.hInstance=instance;wc.lpszClassName=className;RegisterClassW(&wc);
    HWND hwnd=CreateWindowExW(0,className,L"Frameinsight",0,0,0,0,0,NULL,NULL,instance,NULL);
    if(!hwnd){SetEvent(stopEvent);return 1;}
    tray.cbSize=sizeof(tray);tray.hWnd=hwnd;tray.uID=1;tray.uFlags=NIF_MESSAGE|NIF_ICON|NIF_TIP;
    tray.uCallbackMessage=TRAY_MSG;tray.hIcon=LoadIconW(instance,MAKEINTRESOURCEW(1));
    lstrcpynW(tray.szTip,L"Frameinsight - starting...",128);Shell_NotifyIconW(NIM_ADD,&tray);
    SetTimer(hwnd,1,300,NULL);MSG message;
    while(GetMessageW(&message,NULL,0,0)>0){TranslateMessage(&message);DispatchMessageW(&message);}
    CloseHandle(child);CloseHandle(readyEvent);CloseHandle(stopEvent);CloseHandle(mutex);return 0;
}
