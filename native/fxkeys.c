/* fxkeys: globálne klávesové skratky pre LookAtThis.
   Zdroje stlačení (oba naraz, duplicity odfiltruje appka):
     1) GetAsyncKeyState každých 8 ms (ako OBS),
     2) Raw Input s RIDEV_INPUTSINK (klávesy prídu, aj keď je v popredí iná appka).
   Hra bežiaca ako správca (LoL/Vanguard, Valorant…) bežnej appke klávesy nepustí; preto sa dá fxkeys
   spustiť aj so zvýšenými právami a vtedy komunikuje cez pomenovanú rúru.

   fxkeys.exe id:maska:vk ...         výstup na stdout, koniec keď sa zavrie stdin
   fxkeys.exe --pipe \\.\pipe\meno    pripojí sa k rúre appky, nastavenie číta z nej (riadky "cfg id:maska:vk ...")
   fxkeys.exe --rect                  vypíše polohu okna v popredí (JSON) a skončí
   maska: 1=Ctrl 2=Alt 4=Shift 8=Win */
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAXK 8
typedef struct { char id[24]; int mask, vk, down; } Key;
static Key K[MAXK];
static int n;
static CRITICAL_SECTION cs;
static HANDLE pipeH = INVALID_HANDLE_VALUE;
static DWORD rawT[256];      /* čas posledného stlačenia z raw input, 0 = pustené */

static void out(const char *s) {
  if (pipeH != INVALID_HANDLE_VALUE) {
    DWORD w; if (!WriteFile(pipeH, s, (DWORD)strlen(s), &w, NULL)) ExitProcess(0);
  } else { fputs(s, stdout); fflush(stdout); }
}
static void parseCfg(char *line) {
  Key nk[MAXK]; int nn = 0;
  for (char *t = strtok(line, " \r\n"); t && nn < MAXK; t = strtok(NULL, " \r\n")) {
    char *c1 = strchr(t, ':'); if (!c1) continue;
    char *c2 = strchr(c1 + 1, ':'); if (!c2) continue;
    *c1 = 0; *c2 = 0;
    memset(&nk[nn], 0, sizeof(Key));
    strncpy(nk[nn].id, t, 23); nk[nn].mask = atoi(c1 + 1); nk[nn].vk = atoi(c2 + 1); nn++;
  }
  EnterCriticalSection(&cs); memcpy(K, nk, sizeof(Key) * nn); n = nn; LeaveCriticalSection(&cs);
}
static int asyncDn(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
/* modifikátor z raw input platí len chvíľu (keby sa stratilo pustenie, nezasekne sa naveky) */
static int rawDn(int vk) { DWORD t = rawT[vk & 255]; return t && GetTickCount() - t < 4000; }
static int mods(void) {
  return ((asyncDn(VK_CONTROL) || rawDn(VK_CONTROL)) ? 1 : 0) | ((asyncDn(VK_MENU) || rawDn(VK_MENU)) ? 2 : 0) |
         ((asyncDn(VK_SHIFT) || rawDn(VK_SHIFT)) ? 4 : 0) | ((asyncDn(VK_LWIN) || asyncDn(VK_RWIN) || rawDn(VK_LWIN) || rawDn(VK_RWIN)) ? 8 : 0);
}
static void fire(const char *id) { char b[40]; snprintf(b, sizeof b, "%s\n", id); out(b); }

static LRESULT CALLBACK wndProc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
  if (msg == WM_INPUT) {
    RAWINPUT ri; UINT sz = sizeof ri;
    if (GetRawInputData((HRAWINPUT)lp, RID_INPUT, &ri, &sz, sizeof(RAWINPUTHEADER)) != (UINT)-1 && ri.header.dwType == RIM_TYPEKEYBOARD) {
      int vk = ri.data.keyboard.VKey & 255, up = (ri.data.keyboard.Flags & RI_KEY_BREAK) != 0;
      if (vk == VK_LCONTROL || vk == VK_RCONTROL) vk = VK_CONTROL;
      if (vk == VK_LMENU || vk == VK_RMENU) vk = VK_MENU;
      if (vk == VK_LSHIFT || vk == VK_RSHIFT) vk = VK_SHIFT;
      if (vk && vk != 255) {
        if (up) rawT[vk] = 0;
        else {
          int repeat = rawT[vk] != 0;
          rawT[vk] = GetTickCount();
          if (!repeat) {
            int m = mods();
            EnterCriticalSection(&cs);
            for (int i = 0; i < n; i++) if (K[i].vk == vk && K[i].mask == m) fire(K[i].id);
            LeaveCriticalSection(&cs);
          }
        }
      }
    }
  }
  return DefWindowProcW(h, msg, wp, lp);
}

static DWORD WINAPI stdinWatch(LPVOID p) {
  char b[64]; DWORD r; (void)p;
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  while (ReadFile(in, b, sizeof b, &r, NULL) && r) {}
  ExitProcess(0);
  return 0;
}
static DWORD WINAPI pipeRead(LPVOID p) {
  char buf[1024]; int len = 0; DWORD r; (void)p;
  for (;;) {
    if (!ReadFile(pipeH, buf + len, (DWORD)(sizeof buf - 1 - len), &r, NULL) || !r) ExitProcess(0);
    len += r; buf[len] = 0;
    char *nl;
    while ((nl = strchr(buf, '\n'))) {
      *nl = 0;
      if (!strncmp(buf, "cfg", 3)) parseCfg(buf + 3);
      else if (!strcmp(buf, "quit")) ExitProcess(0);
      len -= (int)(nl + 1 - buf); memmove(buf, nl + 1, len + 1);
    }
    if (len >= (int)sizeof buf - 1) len = 0;
  }
}

static void jsonStr(char *dst, size_t cap, const wchar_t *w) {
  char u[520]; WideCharToMultiByte(CP_UTF8, 0, w, -1, u, sizeof u, NULL, NULL);
  size_t k = 0;
  for (char *s = u; *s && k + 3 < cap; s++) { if (*s == '"' || *s == '\\') dst[k++] = '\\'; dst[k++] = (unsigned char)*s < 32 ? ' ' : *s; }
  dst[k] = 0;
}
static void dpiAware(void) {
  typedef BOOL (WINAPI *SetCtx)(HANDLE);
  SetCtx f = (SetCtx)GetProcAddress(GetModuleHandleW(L"user32.dll"), "SetProcessDpiAwarenessContext");
  if (f) f((HANDLE)-4); /* PER_MONITOR_AWARE_V2: súradnice v skutočných pixeloch */
}
/* poloha okna v popredí ako JSON do buf; 0 = žiadne okno */
static int fgJson(char *buf, size_t cap) {
  HWND h = GetForegroundWindow();
  if (!h) return 0;
  RECT c; POINT p = {0, 0};
  GetClientRect(h, &c); ClientToScreen(h, &p);
  MONITORINFO mi; mi.cbSize = sizeof mi;
  GetMonitorInfoW(MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST), &mi);
  wchar_t path[MAX_PATH] = L"", *base = path; DWORD pid = 0, sz = MAX_PATH;
  GetWindowThreadProcessId(h, &pid);
  HANDLE pr = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (pr) { QueryFullProcessImageNameW(pr, 0, path, &sz); CloseHandle(pr); }
  for (wchar_t *q = path; *q; q++) if (*q == L'\\') base = q + 1;
  char exe[600]; jsonStr(exe, sizeof exe, base);
  snprintf(buf, cap, "{\"x\":%ld,\"y\":%ld,\"w\":%ld,\"h\":%ld,\"mx\":%ld,\"my\":%ld,\"mw\":%ld,\"mh\":%ld,\"exe\":\"%s\",\"zoomed\":%d}",
         p.x, p.y, c.right - c.left, c.bottom - c.top, mi.rcMonitor.left, mi.rcMonitor.top,
         mi.rcMonitor.right - mi.rcMonitor.left, mi.rcMonitor.bottom - mi.rcMonitor.top, exe, IsZoomed(h) ? 1 : 0);
  return 1;
}
static int rectMode(void) {
  char b[900]; dpiAware();
  puts(fgJson(b, sizeof b) ? b : "{}");
  return 0;
}

int main(int argc, char **argv) {
  if (argc > 1 && !strcmp(argv[1], "--rect")) return rectMode();
  InitializeCriticalSection(&cs);
  int fgOn = 0;
  for (int i = 1; i < argc; i++) if (!strcmp(argv[i], "--fg")) fgOn = 1;
  if (fgOn) dpiAware();
  if (argc > 2 && !strcmp(argv[1], "--pipe")) {
    for (int i = 0; i < 100 && pipeH == INVALID_HANDLE_VALUE; i++) {
      pipeH = CreateFileA(argv[2], GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
      if (pipeH == INVALID_HANDLE_VALUE) Sleep(100);
    }
    if (pipeH == INVALID_HANDLE_VALUE) return 1;
    CreateThread(NULL, 0, pipeRead, NULL, 0, NULL);
  } else {
    char line[1024] = "";
    for (int i = 1; i < argc; i++) { strncat(line, argv[i], sizeof line - strlen(line) - 2); strcat(line, " "); }
    parseCfg(line);
    CreateThread(NULL, 0, stdinWatch, NULL, 0, NULL);
  }

  WNDCLASSW wc; memset(&wc, 0, sizeof wc);
  wc.lpfnWndProc = wndProc; wc.hInstance = GetModuleHandleW(NULL); wc.lpszClassName = L"fxkeys";
  RegisterClassW(&wc);
  HWND hw = CreateWindowExW(0, L"fxkeys", L"fxkeys", 0, 0, 0, 0, 0, HWND_MESSAGE, NULL, wc.hInstance, NULL);
  RAWINPUTDEVICE rid; rid.usUsagePage = 1; rid.usUsage = 6; rid.dwFlags = RIDEV_INPUTSINK; rid.hwndTarget = hw;
  int raw = hw && RegisterRawInputDevices(&rid, 1, sizeof rid);
  { char b[48]; snprintf(b, sizeof b, "ready %d raw=%d\n", n, raw); out(b); }

  DWORD beat = GetTickCount(), fgT = 0;
  char fgLast[900] = "";
  for (;;) {
    MsgWaitForMultipleObjects(0, NULL, FALSE, 8, QS_ALLINPUT);
    MSG msg;
    while (PeekMessageW(&msg, NULL, 0, 0, PM_REMOVE)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
    int m = mods();
    EnterCriticalSection(&cs);
    for (int i = 0; i < n; i++) {
      int now = K[i].vk && asyncDn(K[i].vk) && m == K[i].mask;
      if (now && !K[i].down) fire(K[i].id);
      K[i].down = now;
    }
    LeaveCriticalSection(&cs);
    /* okno v popredí: pri zmene (iná appka, presun, zmena veľkosti) pošli "fg {json}" — appka z toho vie prepnutia hier a výrez okna */
    if (fgOn && GetTickCount() - fgT > 500) {
      char b[900], line[920]; fgT = GetTickCount();
      if (fgJson(b, sizeof b) && strcmp(b, fgLast)) { strcpy(fgLast, b); snprintf(line, sizeof line, "fg %s\n", b); out(line); }
    }
    if (pipeH != INVALID_HANDLE_VALUE && GetTickCount() - beat > 2000) { beat = GetTickCount(); out(".\n"); }
  }
}
