#include <ApplicationServices/ApplicationServices.h>
#include <dlfcn.h>
#include <lua.h>
#include <lauxlib.h>

typedef struct {
    int callbackRef;
    CGEventMask mask;
    CFMachPortRef tap;
    CFRunLoopSourceRef runloopSrc;
} eventtap_t;

static int start_hid(lua_State *L) {
    eventtap_t *e = (eventtap_t *)luaL_checkudata(L, 1, "hs.eventtap");
    if (e->tap && CGEventTapIsEnabled(e->tap)) {
        lua_settop(L, 1);
        return 1;
    }
    void *h = dlopen("/Applications/Hammerspoon.app/Contents/Frameworks/hs/libeventtap.dylib", RTLD_NOLOAD | RTLD_LAZY);
    CGEventTapCallBack cb = (CGEventTapCallBack)dlsym(h ? h : RTLD_DEFAULT, "eventtap_callback");
    if (!cb) return luaL_error(L, "eventtap_callback symbol not found");

    if (e->tap) {
        CFMachPortInvalidate(e->tap);
        if (e->runloopSrc) {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), e->runloopSrc, kCFRunLoopCommonModes);
            CFRelease(e->runloopSrc);
            e->runloopSrc = NULL;
        }
        CFRelease(e->tap);
        e->tap = NULL;
    }

    e->tap = CGEventTapCreate(
        kCGHIDEventTap,
        kCGHeadInsertEventTap,
        kCGEventTapOptionDefault,
        e->mask,
        cb,
        e
    );
    if (!e->tap) return luaL_error(L, "CGEventTapCreate(kCGHIDEventTap) failed");

    CGEventTapEnable(e->tap, true);
    e->runloopSrc = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, e->tap, 0);
    CFRunLoopAddSource(CFRunLoopGetMain(), e->runloopSrc, kCFRunLoopCommonModes);
    lua_settop(L, 1);
    return 1;
}

int luaopen_hs_hidtap(lua_State *L) {
    lua_pushcfunction(L, start_hid);
    return 1;
}
