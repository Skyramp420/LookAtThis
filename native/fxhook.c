/* fxhook.exe — POKUS: snímanie hry cez oficiálny doplnok OBS (graphics-hook), nie cez snímanie obrazovky.
   Hra, ktorá sa skrýva pred snímaním obrazovky (WDA_EXCLUDEFROMCAPTURE, napr. Valorant), sa takto dá nahrať,
   lebo doplnok berie obraz priamo z hry ešte pred tým, ako ho Windows skryje.

   Používa súbory z nainštalovaného OBS (nič z OBS nepribaľujeme):
     C:\ProgramData\obs-studio-hook\graphics-hook64.dll   (OBS sem doplnok kopíruje)
     <OBS>\data\obs-plugins\win-capture\inject-helper64.exe, get-graphics-offsets64.exe
   Protokol podľa OBS 32.x (plugins/win-capture/game-capture.c, shared/obs-hook-config).

   Použitie: fxhook.exe [nazov.exe] [--obs "C:\Program Files\obs-studio"]
   Výsledok: fxhook-1.bmp … fxhook-3.bmp a fxhook.log vedľa programu. */
#define COBJMACROS
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <d3d11.h>
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>
#include <wchar.h>

/* ---------- štruktúry z OBS (graphics-hook-info.h, hook verzia 1.8) ---------- */
#pragma pack(push, 8)
struct d3d8_offsets { uint32_t present; };
struct d3d9_offsets { uint32_t present, present_ex, present_swap, d3d9_clsoff, is_d3d9ex_clsoff; };
struct d3d12_offsets { uint32_t execute_command_lists; };
struct dxgi_offsets { uint32_t present, resize, present1; };
struct dxgi_offsets2 { uint32_t release; };
struct ddraw_offsets { uint32_t surface_create, surface_restore, surface_release, surface_unlock, surface_blt, surface_flip, surface_set_palette, palette_set_entries; };
struct shtex_data { uint32_t tex_handle; };
enum capture_type { CAPTURE_TYPE_MEMORY, CAPTURE_TYPE_TEXTURE };
struct graphics_offsets { struct d3d8_offsets d3d8; struct d3d9_offsets d3d9; struct dxgi_offsets dxgi; struct ddraw_offsets ddraw; struct dxgi_offsets2 dxgi2; struct d3d12_offsets d3d12; };
struct hook_info {
  uint32_t hook_ver_major, hook_ver_minor;
  enum capture_type type;
  uint32_t window, format, cx, cy, UNUSED_base_cx, UNUSED_base_cy, pitch, map_id, map_size;
  bool flip;
  uint64_t frame_interval;
  bool UNUSED_use_scale, force_shmem, capture_overlay, allow_srgb_alias;
  struct graphics_offsets offsets;
  uint32_t reserved[126];
};
#pragma pack(pop)
_Static_assert(sizeof(struct hook_info) == 648, "ABI OBS");

static FILE *logf;
static void say(const char *fmt, ...) {
  va_list a; char b[2048];
  va_start(a, fmt); vsnprintf(b, sizeof b, fmt, a); va_end(a);
  SYSTEMTIME t; GetLocalTime(&t);
  printf("%s\n", b); fflush(stdout);
  if (logf) { fprintf(logf, "%02d:%02d:%02d.%03d %s\n", t.wHour, t.wMinute, t.wSecond, t.wMilliseconds, b); fflush(logf); }
}

/* ---------- nájdi okno hry ---------- */
static wchar_t want[MAX_PATH] = L"valorant-win64-shipping.exe";
static HWND best; static LONG bestArea;
static BOOL CALLBACK enumWin(HWND h, LPARAM lp) {
  (void)lp;
  if (!IsWindowVisible(h) || GetWindow(h, GW_OWNER)) return TRUE;
  DWORD pid = 0; GetWindowThreadProcessId(h, &pid);
  HANDLE p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!p) return TRUE;
  wchar_t path[MAX_PATH]; DWORD n = MAX_PATH; bool ok = false;
  if (QueryFullProcessImageNameW(p, 0, path, &n)) { wchar_t *b = wcsrchr(path, L'\\'); ok = !_wcsicmp(b ? b + 1 : path, want); }
  CloseHandle(p);
  if (!ok) return TRUE;
  RECT r; GetClientRect(h, &r);
  LONG a = (r.right - r.left) * (r.bottom - r.top);
  if (a > bestArea) { bestArea = a; best = h; }
  return TRUE;
}

/* ---------- spusti program a prečítaj jeho výstup ---------- */
static DWORD runCapture(const wchar_t *cmdline, char *out, size_t cap, DWORD timeoutMs) {
  SECURITY_ATTRIBUTES sa = { sizeof sa, NULL, TRUE };
  HANDLE rd = NULL, wr = NULL;
  if (out) { CreatePipe(&rd, &wr, &sa, 0); SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0); }
  STARTUPINFOW si = { sizeof si }; PROCESS_INFORMATION pi = {0};
  if (out) { si.dwFlags = STARTF_USESTDHANDLES; si.hStdOutput = wr; si.hStdError = wr; }
  wchar_t buf[4096]; wcsncpy(buf, cmdline, 4095); buf[4095] = 0;
  if (!CreateProcessW(NULL, buf, NULL, NULL, out != NULL, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
    if (out) { CloseHandle(rd); CloseHandle(wr); }
    return 0xFFFFFFF0u;
  }
  if (out) {
    CloseHandle(wr);
    size_t k = 0; DWORD got;
    while (k + 1 < cap && ReadFile(rd, out + k, (DWORD)(cap - 1 - k), &got, NULL) && got) k += got;
    out[k] = 0; CloseHandle(rd);
  }
  DWORD code = 0xFFFFFFF1u;
  if (WaitForSingleObject(pi.hProcess, timeoutMs) == WAIT_OBJECT_0) GetExitCodeProcess(pi.hProcess, &code);
  CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
  return code;
}

static uint32_t iniVal(const char *ini, const char *section, const char *key) {
  char sec[64]; snprintf(sec, sizeof sec, "[%s]", section);
  const char *s = strstr(ini, sec); if (!s) return 0;
  const char *end = strchr(s + 1, '['); size_t kl = strlen(key);
  for (const char *p = s; p && (!end || p < end); p = strchr(p, '\n')) {
    if (*p == '\n') p++;
    if (!strncmp(p, key, kl) && p[kl] == '=') return (uint32_t)strtoul(p + kl + 1, NULL, 0);
  }
  return 0;
}

/* ---------- logy z doplnku (rúra CaptureHook_Pipe<pid>) ---------- */
static DWORD WINAPI pipeThread(LPVOID arg) {
  DWORD pid = (DWORD)(uintptr_t)arg;
  char name[96]; snprintf(name, sizeof name, "\\\\.\\pipe\\CaptureHook_Pipe%lu", (unsigned long)pid);
  SECURITY_DESCRIPTOR sd; InitializeSecurityDescriptor(&sd, SECURITY_DESCRIPTOR_REVISION); SetSecurityDescriptorDacl(&sd, TRUE, NULL, FALSE);
  SECURITY_ATTRIBUTES sa = { sizeof sa, &sd, FALSE };
  for (;;) {
    HANDLE h = CreateNamedPipeA(name, PIPE_ACCESS_DUPLEX, PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT, 1, 1024, 1024, 0, &sa);
    if (h == INVALID_HANDLE_VALUE) { say("  (rúra na logy doplnku sa nedá vytvoriť: %lu)", GetLastError()); return 0; }
    if (ConnectNamedPipe(h, NULL) || GetLastError() == ERROR_PIPE_CONNECTED) {
      char b[1100]; DWORD n;
      while (ReadFile(h, b, 1024, &n, NULL) || GetLastError() == ERROR_MORE_DATA) { if (n) { b[n] = 0; say("  [doplnok OBS] %s", b); } }
    }
    CloseHandle(h);
  }
}

static HANDLE openEv(const wchar_t *name, DWORD pid) {
  wchar_t n[96]; _snwprintf(n, 96, L"%ls%lu", name, (unsigned long)pid);
  return OpenEventW(EVENT_MODIFY_STATE | SYNCHRONIZE, FALSE, n);
}

/* ---------- uloženie snímky ako BMP ---------- */
static bool saveBmp(const wchar_t *file, const uint8_t *src, UINT pitch, UINT w, UINT h, DXGI_FORMAT fmt) {
  bool rgba = fmt == DXGI_FORMAT_R8G8B8A8_UNORM || fmt == DXGI_FORMAT_R8G8B8A8_UNORM_SRGB || fmt == DXGI_FORMAT_R8G8B8A8_TYPELESS;
  bool bgra = fmt == DXGI_FORMAT_B8G8R8A8_UNORM || fmt == DXGI_FORMAT_B8G8R8A8_UNORM_SRGB || fmt == DXGI_FORMAT_B8G8R8A8_TYPELESS || fmt == DXGI_FORMAT_B8G8R8X8_UNORM || fmt == DXGI_FORMAT_B8G8R8X8_UNORM_SRGB;
  bool r10 = fmt == DXGI_FORMAT_R10G10B10A2_UNORM || fmt == DXGI_FORMAT_R10G10B10A2_TYPELESS;
  if (!rgba && !bgra && !r10) { say("  formát textúry %d neviem uložiť", (int)fmt); return false; }
  UINT row = (w * 3 + 3) & ~3u;
  BITMAPFILEHEADER fh = {0}; BITMAPINFOHEADER ih = {0};
  fh.bfType = 0x4D42; fh.bfOffBits = sizeof fh + sizeof ih; fh.bfSize = fh.bfOffBits + row * h;
  ih.biSize = sizeof ih; ih.biWidth = (LONG)w; ih.biHeight = (LONG)h; ih.biPlanes = 1; ih.biBitCount = 24;
  FILE *f = _wfopen(file, L"wb"); if (!f) return false;
  fwrite(&fh, sizeof fh, 1, f); fwrite(&ih, sizeof ih, 1, f);
  uint8_t *line = calloc(1, row);
  for (UINT y = 0; y < h; y++) {
    const uint8_t *s = src + (size_t)(h - 1 - y) * pitch;
    for (UINT x = 0; x < w; x++) {
      uint8_t r, g, b;
      if (r10) { uint32_t v = ((const uint32_t *)s)[x]; r = (uint8_t)((v & 1023) >> 2); g = (uint8_t)(((v >> 10) & 1023) >> 2); b = (uint8_t)(((v >> 20) & 1023) >> 2); }
      else if (rgba) { r = s[x * 4]; g = s[x * 4 + 1]; b = s[x * 4 + 2]; }
      else { b = s[x * 4]; g = s[x * 4 + 1]; r = s[x * 4 + 2]; }
      line[x * 3] = b; line[x * 3 + 1] = g; line[x * 3 + 2] = r;
    }
    fwrite(line, 1, row, f);
  }
  free(line); fclose(f);
  return true;
}

static void pause(void) { printf("\nStlač Enter na zatvorenie..."); fflush(stdout); getchar(); }

int wmain(int argc, wchar_t **argv) {
  wchar_t dir[MAX_PATH]; GetModuleFileNameW(NULL, dir, MAX_PATH); *(wcsrchr(dir, L'\\') + 1) = 0;
  wchar_t lp[MAX_PATH]; _snwprintf(lp, MAX_PATH, L"%lsfxhook.log", dir); logf = _wfopen(lp, L"w");
  wchar_t obs[MAX_PATH] = L"C:\\Program Files\\obs-studio";
  for (int i = 1; i < argc; i++) {
    if (!wcscmp(argv[i], L"--obs") && i + 1 < argc) wcsncpy(obs, argv[++i], MAX_PATH - 1);
    else wcsncpy(want, argv[i], MAX_PATH - 1);
  }
  say("fxhook – pokus o snímanie hry cez doplnok OBS");
  say("hľadám okno: %ls", want);

  /* 1) okno hry */
  for (int t = 0; t < 30 && !best; t++) { EnumWindows(enumWin, 0); if (!best) Sleep(1000); }
  if (!best) { say("CHYBA: okno hry som nenašiel (je hra zapnutá?)"); pause(); return 1; }
  DWORD pid = 0, tid = GetWindowThreadProcessId(best, &pid);
  RECT rc; GetClientRect(best, &rc);
  DWORD aff = 0; GetWindowDisplayAffinity(best, &aff);
  say("okno nájdené: pid %lu, vlákno %lu, %ldx%ld, skrytá pred snímaním obrazovky: %s", (unsigned long)pid, (unsigned long)tid, rc.right, rc.bottom, aff == 0x11 ? "ÁNO" : "nie");

  /* 2) súbory OBS */
  wchar_t wc[MAX_PATH], inject[MAX_PATH], offs[MAX_PATH], hook[MAX_PATH];
  _snwprintf(wc, MAX_PATH, L"%ls\\data\\obs-plugins\\win-capture\\", obs);
  _snwprintf(inject, MAX_PATH, L"%lsinject-helper64.exe", wc);
  _snwprintf(offs, MAX_PATH, L"%lsget-graphics-offsets64.exe", wc);
  wchar_t pd[MAX_PATH] = L"C:\\ProgramData"; GetEnvironmentVariableW(L"ProgramData", pd, MAX_PATH);
  _snwprintf(hook, MAX_PATH, L"%ls\\obs-studio-hook\\graphics-hook64.dll", pd);
  if (GetFileAttributesW(hook) == INVALID_FILE_ATTRIBUTES) _snwprintf(hook, MAX_PATH, L"%lsgraphics-hook64.dll", wc);
  if (GetFileAttributesW(inject) == INVALID_FILE_ATTRIBUTES || GetFileAttributesW(hook) == INVALID_FILE_ATTRIBUTES || GetFileAttributesW(offs) == INVALID_FILE_ATTRIBUTES) {
    say("CHYBA: nenašiel som súbory OBS (%ls). Ak máš OBS inde, spusti: fxhook.exe --obs \"cesta k obs-studio\"", wc); pause(); return 2;
  }
  say("doplnok: %ls", hook);

  /* 3) adresy funkcií grafiky (rovnako ako OBS) */
  char ini[4096] = "";
  wchar_t cmd[2048]; _snwprintf(cmd, 2048, L"\"%ls\"", offs);
  DWORD oc = runCapture(cmd, ini, sizeof ini, 15000);
  struct graphics_offsets go = {0};
  go.d3d8.present = iniVal(ini, "d3d8", "present");
  go.d3d9.present = iniVal(ini, "d3d9", "present"); go.d3d9.present_ex = iniVal(ini, "d3d9", "present_ex");
  go.d3d9.present_swap = iniVal(ini, "d3d9", "present_swap"); go.d3d9.d3d9_clsoff = iniVal(ini, "d3d9", "d3d9_clsoff");
  go.d3d9.is_d3d9ex_clsoff = iniVal(ini, "d3d9", "is_d3d9ex_clsoff");
  go.dxgi.present = iniVal(ini, "dxgi", "present"); go.dxgi.present1 = iniVal(ini, "dxgi", "present1");
  go.dxgi.resize = iniVal(ini, "dxgi", "resize"); go.dxgi2.release = iniVal(ini, "dxgi", "release");
  say("adresy grafiky: dxgi present=0x%x resize=0x%x (kód %lu)", go.dxgi.present, go.dxgi.resize, (unsigned long)oc);
  if (!go.dxgi.present) { say("CHYBA: adresy grafiky sa nepodarilo zistiť. Výstup: %s", ini); pause(); return 3; }

  /* 4) kontrolný mutex (doplnok beží, kým existuje) + rúra na jeho logy */
  wchar_t n[96]; _snwprintf(n, 96, L"CaptureHook_KeepAlive%lu", (unsigned long)pid);
  HANDLE keep = CreateMutexW(NULL, FALSE, n);
  CreateThread(NULL, 0, pipeThread, (LPVOID)(uintptr_t)pid, 0, NULL);

  /* 5) napoj doplnok do hry (režim kompatibilný s anti-cheatom, ako OBS) */
  HANDLE restart = openEv(L"CaptureHook_Restart", pid);
  if (restart) { say("doplnok už v hre je (napr. z OBS), použijem ho"); SetEvent(restart); }
  else {
    _snwprintf(cmd, 2048, L"\"%ls\" \"%ls\" 1 %lu", inject, hook, (unsigned long)tid);
    say("napájam doplnok do hry (inject-helper, anti-cheat režim)…");
    DWORD ic = runCapture(cmd, NULL, 0, 20000);
    say("inject-helper skončil s kódom %ld", (long)ic);
    if (ic != 0) { say("CHYBA: napojenie zlyhalo. Ak je to vo Valorante, anti-cheat ho zrejme nepustil."); pause(); return 4; }
  }

  /* 6) počkaj, kým sa doplnok v hre rozbehne (vytvorí svoje mutexy a zdieľanú pamäť) */
  HANDLE m1 = NULL, m2 = NULL, map = NULL;
  for (int t = 0; t < 100 && !(m1 && m2 && map); t++) {
    wchar_t a[96];
    if (!m1) { _snwprintf(a, 96, L"CaptureHook_TextureMutex1%lu", (unsigned long)pid); m1 = OpenMutexW(SYNCHRONIZE, FALSE, a); }
    if (!m2) { _snwprintf(a, 96, L"CaptureHook_TextureMutex2%lu", (unsigned long)pid); m2 = OpenMutexW(SYNCHRONIZE, FALSE, a); }
    if (!map) { _snwprintf(a, 96, L"CaptureHook_HookInfo%lu", (unsigned long)pid); map = OpenFileMappingW(FILE_MAP_READ | FILE_MAP_WRITE, FALSE, a); }
    if (!(m1 && m2 && map)) Sleep(100);
  }
  if (!map) { say("CHYBA: doplnok sa v hre nerozbehol do 10 s (zdieľaná pamäť chýba, chyba %lu)", GetLastError()); pause(); return 5; }
  struct hook_info *hi = MapViewOfFile(map, FILE_MAP_ALL_ACCESS, 0, 0, sizeof *hi);
  if (!hi) { say("CHYBA: zdieľaná pamäť sa nedá namapovať: %lu", GetLastError()); pause(); return 6; }
  hi->offsets = go; hi->capture_overlay = false; hi->force_shmem = false; hi->UNUSED_use_scale = false;
  hi->allow_srgb_alias = true; hi->frame_interval = 1000000000ULL / 60;

  HANDLE evStop = openEv(L"CaptureHook_Stop", pid), evInit = openEv(L"CaptureHook_Initialize", pid);
  HANDLE evReady = openEv(L"CaptureHook_HookReady", pid);
  if (!restart) restart = openEv(L"CaptureHook_Restart", pid);
  if (!evInit || !evReady) { say("CHYBA: udalosti doplnku chýbajú (%lu)", GetLastError()); pause(); return 7; }
  SetEvent(evInit);
  say("doplnok beží, čakám na prvý obraz z hry (hra musí byť na obrazovke, prepni sa do nej)…");

  /* 7) čakaj na zdieľanú textúru */
  if (WaitForSingleObject(evReady, 30000) != WAIT_OBJECT_0) { say("CHYBA: hra do 30 s neposlala obraz. Bola v popredí?"); pause(); return 8; }
  say("hook verzia %u.%u, typ %s, %ux%u, formát %u", hi->hook_ver_major, hi->hook_ver_minor, hi->type == CAPTURE_TYPE_TEXTURE ? "zdieľaná textúra (GPU)" : "pamäť", hi->cx, hi->cy, hi->format);
  if (hi->type != CAPTURE_TYPE_TEXTURE) { say("CHYBA: doplnok zvolil kopírovanie cez pamäť, pokus to zatiaľ nevie"); pause(); return 9; }
  wchar_t tn[128]; _snwprintf(tn, 128, L"CaptureHook_Texture_%llu_%lu", (unsigned long long)hi->window, (unsigned long)hi->map_id);
  HANDLE tmap = OpenFileMappingW(FILE_MAP_READ | FILE_MAP_WRITE, FALSE, tn);
  if (!tmap) { _snwprintf(tn, 128, L"CaptureHook_Texture_%llu_%lu", (unsigned long long)(uintptr_t)best, (unsigned long)hi->map_id); tmap = OpenFileMappingW(FILE_MAP_READ | FILE_MAP_WRITE, FALSE, tn); }
  if (!tmap) { say("CHYBA: dáta textúry chýbajú (%lu)", GetLastError()); pause(); return 10; }
  struct shtex_data *sd = MapViewOfFile(tmap, FILE_MAP_ALL_ACCESS, 0, 0, sizeof *sd);

  /* 8) otvor textúru na grafike a ulož 3 snímky */
  ID3D11Device *dev = NULL; ID3D11DeviceContext *ctx = NULL;
  HRESULT hr = D3D11CreateDevice(NULL, D3D_DRIVER_TYPE_HARDWARE, NULL, D3D11_CREATE_DEVICE_BGRA_SUPPORT, NULL, 0, D3D11_SDK_VERSION, &dev, NULL, &ctx);
  if (FAILED(hr)) { say("CHYBA: D3D11 zariadenie: 0x%08lx", (unsigned long)hr); pause(); return 11; }
  ID3D11Texture2D *tex = NULL;
  hr = ID3D11Device_OpenSharedResource(dev, (HANDLE)(uintptr_t)sd->tex_handle, &IID_ID3D11Texture2D, (void **)&tex);
  if (FAILED(hr)) { say("CHYBA: zdieľanú textúru sa nepodarilo otvoriť: 0x%08lx", (unsigned long)hr); pause(); return 12; }
  D3D11_TEXTURE2D_DESC d; ID3D11Texture2D_GetDesc(tex, &d);
  say("textúra z hry: %ux%u, formát DXGI %d", d.Width, d.Height, (int)d.Format);
  D3D11_TEXTURE2D_DESC sdsc = d;
  sdsc.Usage = D3D11_USAGE_STAGING; sdsc.BindFlags = 0; sdsc.CPUAccessFlags = D3D11_CPU_ACCESS_READ; sdsc.MiscFlags = 0; sdsc.MipLevels = 1; sdsc.ArraySize = 1;
  ID3D11Texture2D *stg = NULL;
  hr = ID3D11Device_CreateTexture2D(dev, &sdsc, NULL, &stg);
  if (FAILED(hr)) { say("CHYBA: pomocná textúra: 0x%08lx", (unsigned long)hr); pause(); return 13; }
  int saved = 0;
  for (int i = 1; i <= 3; i++) {
    Sleep(1000);
    ID3D11DeviceContext_CopyResource(ctx, (ID3D11Resource *)stg, (ID3D11Resource *)tex);
    D3D11_MAPPED_SUBRESOURCE ms;
    if (SUCCEEDED(ID3D11DeviceContext_Map(ctx, (ID3D11Resource *)stg, 0, D3D11_MAP_READ, 0, &ms))) {
      wchar_t f[MAX_PATH]; _snwprintf(f, MAX_PATH, L"%lsfxhook-%d.bmp", dir, i);
      if (saveBmp(f, ms.pData, ms.RowPitch, d.Width, d.Height, d.Format)) { saved++; say("uložené: fxhook-%d.bmp", i); }
      ID3D11DeviceContext_Unmap(ctx, (ID3D11Resource *)stg, 0);
    }
  }
  GetWindowDisplayAffinity(best, &aff);
  say("hra je teraz skrytá pred snímaním obrazovky: %s", aff == 0x11 ? "ÁNO (a aj tak sme ju zachytili, ak sú obrázky dobré)" : "nie");

  /* 9) uprac: zastav doplnok (bez kontrolného mutexu sa v hre do pár sekúnd vypne) */
  if (evStop) SetEvent(evStop);
  CloseHandle(keep);
  say(saved ? "HOTOVO: pozri obrázky fxhook-1..3.bmp vedľa programu" : "nič sa neuložilo");
  pause();
  return saved ? 0 : 14;
}
