/* fxkeys: sleduje globálne klávesové skratky cez GetAsyncKeyState.
   Funguje aj keď hra beží ako správca, v exkluzívnom režime alebo si klávesnicu berie cez raw input
   (RegisterHotKey v takých prípadoch skratku nedostane).
   Použitie: fxkeys.exe id:maska:vk ...   (maska: 1=Ctrl 2=Alt 4=Shift 8=Win)
   Pri stlačení vypíše id na stdout. Skončí, keď sa zatvorí stdin (rodič skončil). */
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAXK 8
static struct { char id[24]; int mask, vk, down; } K[MAXK];
static int n;

static DWORD WINAPI watch(LPVOID p) {
  char b[64]; DWORD r; (void)p;
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  while (ReadFile(in, b, sizeof b, &r, NULL) && r) {}
  ExitProcess(0);
  return 0;
}
static int dn(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

int main(int argc, char **argv) {
  for (int i = 1; i < argc && n < MAXK; i++) {
    char *a = argv[i], *c1 = strchr(a, ':'); if (!c1) continue;
    char *c2 = strchr(c1 + 1, ':'); if (!c2) continue;
    *c1 = 0; *c2 = 0;
    strncpy(K[n].id, a, 23); K[n].mask = atoi(c1 + 1); K[n].vk = atoi(c2 + 1); n++;
  }
  CreateThread(NULL, 0, watch, NULL, 0, NULL);
  setvbuf(stdout, NULL, _IONBF, 0);
  printf("ready %d\n", n);
  for (;;) {
    int m = (dn(VK_CONTROL) ? 1 : 0) | (dn(VK_MENU) ? 2 : 0) | (dn(VK_SHIFT) ? 4 : 0) | ((dn(VK_LWIN) || dn(VK_RWIN)) ? 8 : 0);
    for (int i = 0; i < n; i++) {
      int now = K[i].vk && dn(K[i].vk) && m == K[i].mask;
      if (now && !K[i].down) printf("%s\n", K[i].id);
      K[i].down = now;
    }
    Sleep(8);
  }
}
