#include "hack.h"

typedef void (*godothack_shim_callback_t)(const char *, void *, const char *,
                                          ...);

extern int godothack_windmain_unused(int, char **);
extern void shim_graphics_set_callback(godothack_shim_callback_t);

void
godothack_core_run(godothack_shim_callback_t callback, int argc, char **argv)
{
    shim_graphics_set_callback(callback);
    (void) godothack_windmain_unused(argc, argv);
}

void
godothack_core_mark_window_inited(void)
{
    iflags.window_inited = TRUE;
}

void
godothack_core_player_setup(void)
{
    (void) genl_player_setup(0);
}

const char *
godothack_core_status_field_name(int fieldidx)
{
    return bl_idx_to_fldname(fieldidx);
}

const char *
godothack_core_status_value_to_string(int fieldidx, void *value, char *buffer,
                                      int buffer_size)
{
    if (!buffer || buffer_size <= 0)
        return "";
    buffer[0] = '\0';

    if (!value)
        return "";

    if (fieldidx == BL_CONDITION) {
        Snprintf(buffer, buffer_size, "%lu", *((unsigned long *) value));
        return buffer;
    }

    return (const char *) value;
}
