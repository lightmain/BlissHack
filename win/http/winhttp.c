/* NetHack 5.0  winhttp.c */
/* Copyright (c) RemoteHack contributors, 2024 */
/* NetHack may be freely redistributed.  See license for details. */

#include "hack.h"

#ifdef HTTP_GRAPHICS

#include "civetweb.h"

#include <stdio.h>
#include <string.h>
#include <signal.h>
#include <unistd.h>

#define REMOTEHACK_VERSION "0.1.0"
#define REMOTEHACK_DEFAULT_PORT "8080"

static struct mg_context *http_ctx = NULL;
static volatile int http_server_running = 0;

/* --- HTTP handlers --- */

static int
ping_handler(struct mg_connection *conn, void *cbdata UNUSED)
{
    const char *json =
        "{\"status\":\"ok\","
        "\"server\":\"RemoteHack\","
        "\"version\":\"" REMOTEHACK_VERSION "\"}";
    size_t json_len = strlen(json);

    mg_send_http_ok(conn, "application/json", (long long)json_len);
    mg_write(conn, json, json_len);
    return 200;
}

/* --- HTTP server lifecycle --- */

static void
http_start_server(void)
{
    const char *options[] = {
        "listening_ports", REMOTEHACK_DEFAULT_PORT,
        "request_timeout_ms", "60000",
        "num_threads", "2",
        NULL
    };
    struct mg_callbacks callbacks;

    if (http_ctx)
        return;

    memset(&callbacks, 0, sizeof(callbacks));

    http_ctx = mg_start(&callbacks, NULL, options);
    if (!http_ctx) {
        raw_printf("RemoteHack: failed to start HTTP server on port %s",
                   REMOTEHACK_DEFAULT_PORT);
        return;
    }

    mg_set_request_handler(http_ctx, "/api/ping", ping_handler, NULL);

    http_server_running = 1;
    raw_printf("RemoteHack: HTTP server listening on port %s",
               REMOTEHACK_DEFAULT_PORT);
}

static void
http_stop_server(void)
{
    if (http_ctx) {
        mg_stop(http_ctx);
        http_ctx = NULL;
        http_server_running = 0;
    }
}

/* --- Forward declarations for all window_procs functions --- */

static void http_init_nhwindows(int *, char **);
static void http_player_selection(void);
static void http_askname(void);
static void http_get_nh_event(void);
static void http_exit_nhwindows(const char *);
static void http_suspend_nhwindows(const char *);
static void http_resume_nhwindows(void);
static winid http_create_nhwindow(int);
static void http_clear_nhwindow(winid);
static void http_display_nhwindow(winid, boolean);
static void http_destroy_nhwindow(winid);
static void http_curs(winid, int, int);
static void http_putstr(winid, int, const char *);
static void http_display_file(const char *, boolean);
static void http_start_menu(winid, unsigned long);
static void http_add_menu(winid, const glyph_info *, const ANY_P *,
                          char, char, int, int, const char *, unsigned int);
static void http_end_menu(winid, const char *);
static int http_select_menu(winid, int, MENU_ITEM_P **);
static char http_message_menu(char, int, const char *);
static void http_mark_synch(void);
static void http_wait_synch(void);
#ifdef CLIPPING
static void http_cliparound(int, int);
#endif
#ifdef POSITIONBAR
static void http_update_positionbar(char *);
#endif
static void http_print_glyph(winid, coordxy, coordxy,
                              const glyph_info *, const glyph_info *);
static void http_raw_print(const char *);
static void http_raw_print_bold(const char *);
static int http_nhgetch(void);
static int http_nh_poskey(coordxy *, coordxy *, int *);
static void http_nhbell(void);
static int http_doprev_message(void);
static char http_yn_function(const char *, const char *, char);
static void http_getlin(const char *, char *);
static int http_get_ext_cmd(void);
static void http_number_pad(int);
static void http_delay_output(void);
#ifdef CHANGE_COLOR
static void http_change_color(int, long, int);
#ifdef MAC68K
static void http_change_background(int);
static short http_set_font_name(winid, char *);
#endif
static char *http_get_color_string(void);
#endif
static void http_preference_update(const char *);
static char *http_getmsghistory(boolean);
static void http_putmsghistory(const char *, boolean);
static void http_status_init(void);
#ifdef STATUS_HILITES
static void http_status_update(int, genericptr_t, int, int, int,
                                unsigned long *);
#endif
static void http_update_inventory(int);
static win_request_info *http_ctrl_nhwindow(winid, int, win_request_info *);

/* Interface definition used in windows.c */
struct window_procs http_procs = {
    WPID(http),
    (0
     | WC_ASCII_MAP
     | WC_MOUSE_SUPPORT
     | WC_COLOR | WC_HILITE_PET | WC_INVERSE | WC_EIGHT_BIT_IN),
    (0
#if defined(SELECTSAVED)
     | WC2_SELECTSAVED
#endif
#if defined(STATUS_HILITES)
     | WC2_HILITE_STATUS | WC2_HITPOINTBAR | WC2_FLUSH_STATUS
     | WC2_RESET_STATUS
#endif
     | WC2_DARKGRAY | WC2_SUPPRESS_HIST | WC2_STATUSLINES),
    {1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1},
    http_init_nhwindows, http_player_selection, http_askname, http_get_nh_event,
    http_exit_nhwindows, http_suspend_nhwindows, http_resume_nhwindows,
    http_create_nhwindow, http_clear_nhwindow, http_display_nhwindow,
    http_destroy_nhwindow, http_curs, http_putstr, genl_putmixed,
    http_display_file, http_start_menu, http_add_menu, http_end_menu,
    http_select_menu, http_message_menu, http_mark_synch,
    http_wait_synch,
#ifdef CLIPPING
    http_cliparound,
#endif
#ifdef POSITIONBAR
    http_update_positionbar,
#endif
    http_print_glyph, http_raw_print, http_raw_print_bold, http_nhgetch,
    http_nh_poskey, http_nhbell, http_doprev_message, http_yn_function,
    http_getlin, http_get_ext_cmd, http_number_pad, http_delay_output,
#ifdef CHANGE_COLOR
    http_change_color,
#ifdef MAC68K
    http_change_background, http_set_font_name,
#endif
    http_get_color_string,
#endif
    genl_outrip,
    http_preference_update,
    http_getmsghistory, http_putmsghistory,
    http_status_init,
    genl_status_finish, genl_status_enablefield,
#ifdef STATUS_HILITES
    http_status_update,
#else
    genl_status_update,
#endif
    genl_can_suspend_yes,
    http_update_inventory,
    http_ctrl_nhwindow,
};

/* --- window_procs implementations --- */

static void
http_init_nhwindows(int *argcp UNUSED, char **argv UNUSED)
{
    http_start_server();
    iflags.window_inited = TRUE;
    fprintf(stderr, "RemoteHack: init_nhwindows done\n");
}

static void
http_player_selection(void)
{
    fprintf(stderr, "RemoteHack: player_selection called\n");
}

static void
http_askname(void)
{
    fprintf(stderr, "RemoteHack: askname called\n");
    Strcpy(svp.plname, "HttpPlayer");
}

static void
http_get_nh_event(void)
{
}

static void
http_exit_nhwindows(const char *str UNUSED)
{
    fprintf(stderr, "RemoteHack: exit_nhwindows called\n");
    http_stop_server();
    iflags.window_inited = FALSE;
}

static void
http_suspend_nhwindows(const char *str UNUSED)
{
}

static void
http_resume_nhwindows(void)
{
}

#define HTTP_MAX_WINDOWS 16
static int http_window_count = 0;

static winid
http_create_nhwindow(int type)
{
    if (http_window_count >= HTTP_MAX_WINDOWS)
        return WIN_ERR;
    fprintf(stderr, "RemoteHack: create_nhwindow type=%d -> id=%d\n",
            type, http_window_count);
    return http_window_count++;
}

static void
http_clear_nhwindow(winid window UNUSED)
{
}

static void
http_display_nhwindow(winid window UNUSED, boolean blocking UNUSED)
{
}

static void
http_destroy_nhwindow(winid window UNUSED)
{
}

static void
http_curs(winid window UNUSED, int x UNUSED, int y UNUSED)
{
}

static void
http_putstr(winid window, int attr UNUSED, const char *str)
{
    fprintf(stderr, "RemoteHack: putstr win=%d str='%s'\n", window, str ? str : "(null)");
}

static void
http_display_file(const char *fname UNUSED, boolean complain UNUSED)
{
}

static void
http_start_menu(winid window UNUSED, unsigned long mbehavior UNUSED)
{
}

static void
http_add_menu(winid window UNUSED, const glyph_info *glyphinfo UNUSED,
              const ANY_P *identifier UNUSED, char ch UNUSED,
              char gch UNUSED, int attr UNUSED, int clr UNUSED,
              const char *str UNUSED, unsigned int itemflags UNUSED)
{
}

static void
http_end_menu(winid window UNUSED, const char *prompt UNUSED)
{
}

static int
http_select_menu(winid window UNUSED, int how UNUSED,
                 MENU_ITEM_P **menu_list UNUSED)
{
    return -1;
}

static char
http_message_menu(char let UNUSED, int how UNUSED, const char *mesg UNUSED)
{
    return '\033';
}

static void
http_mark_synch(void)
{
}

static void
http_wait_synch(void)
{
}

#ifdef CLIPPING
static void
http_cliparound(int x UNUSED, int y UNUSED)
{
}
#endif

#ifdef POSITIONBAR
static void
http_update_positionbar(char *posbar UNUSED)
{
}
#endif

static void
http_print_glyph(winid window UNUSED, coordxy x UNUSED, coordxy y UNUSED,
                  const glyph_info *glyphinfo UNUSED,
                  const glyph_info *bkglyphinfo UNUSED)
{
}

static void
http_raw_print(const char *str)
{
    fprintf(stderr, "RemoteHack: raw_print '%s'\n", str ? str : "(null)");
}

static void
http_raw_print_bold(const char *str)
{
    fprintf(stderr, "RemoteHack: raw_print_bold '%s'\n", str ? str : "(null)");
}

static int
http_nhgetch(void)
{
    fprintf(stderr, "RemoteHack: nhgetch called, blocking...\n");
    while (http_server_running) {
        sleep(1);
    }
    return '\033';
}

static int
http_nh_poskey(coordxy *x UNUSED, coordxy *y UNUSED, int *mod UNUSED)
{
    while (http_server_running) {
        sleep(1);
    }
    return '\033';
}

static void
http_nhbell(void)
{
}

static int
http_doprev_message(void)
{
    return 0;
}

static char
http_yn_function(const char *query UNUSED, const char *resp UNUSED,
                  char def)
{
    fprintf(stderr, "RemoteHack: yn_function query='%s' resp='%s' def='%c'\n",
            query ? query : "(null)", resp ? resp : "(null)", def);
    return def;
}

static void
http_getlin(const char *prompt UNUSED, char *outbuf)
{
    Strcpy(outbuf, "\033");
}

static int
http_get_ext_cmd(void)
{
    return -1;
}

static void
http_number_pad(int state UNUSED)
{
}

static void
http_delay_output(void)
{
}

#ifdef CHANGE_COLOR
static void
http_change_color(int color UNUSED, long rgb UNUSED, int reverse UNUSED)
{
}

#ifdef MAC68K
static void
http_change_background(int bw UNUSED)
{
}

static short
http_set_font_name(winid window UNUSED, char *font UNUSED)
{
    return 0;
}
#endif /* MAC68K */

static char *
http_get_color_string(void)
{
    return (char *) "";
}
#endif /* CHANGE_COLOR */

static void
http_preference_update(const char *pref UNUSED)
{
}

static char *
http_getmsghistory(boolean init UNUSED)
{
    return (char *) 0;
}

static void
http_putmsghistory(const char *msg UNUSED, boolean is_restoring UNUSED)
{
}

static void
http_status_init(void)
{
}

#ifdef STATUS_HILITES
static void
http_status_update(int fldidx UNUSED, genericptr_t ptr UNUSED,
                    int chg UNUSED, int percent UNUSED, int color UNUSED,
                    unsigned long *colormasks UNUSED)
{
}
#endif

static void
http_update_inventory(int arg UNUSED)
{
}

static win_request_info *
http_ctrl_nhwindow(winid window UNUSED, int request UNUSED,
                    win_request_info *wri UNUSED)
{
    return (win_request_info *) 0;
}

#endif /* HTTP_GRAPHICS */
