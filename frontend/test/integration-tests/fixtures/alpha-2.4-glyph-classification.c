#include "hack.h"

#include <stdio.h>

struct glyph_case {
    const char *name;
    int glyph;
    int classified;
    int identity;
};

/*
 * Match the intended resolver priority: temporary effects and traps are
 * rejected before the broad compatibility glyph_is_cmap() range is used.
 */
static boolean
is_intended_terrain(int glyph)
{
    return glyph_is_cmap(glyph) && !glyph_is_trap(glyph)
           && !glyph_is_cmap_zap(glyph) && !glyph_is_swallow(glyph)
           && !glyph_is_explosion(glyph);
}

/** Print one representative result from the current display.h contract. */
static void
print_case(const struct glyph_case *test_case)
{
    printf("%s\t%d\t%d\t%d\n", test_case->name, test_case->glyph,
           test_case->classified, test_case->identity);
}

/** Exercise supported glyph families and one explicitly unsupported effect. */
int
main(void)
{
    const int normal = monnum_to_glyph(PM_NEWT, MALE);
    const int pet = petnum_to_glyph(PM_NEWT, MALE);
    const int ridden = ridden_monnum_to_glyph(PM_NEWT, MALE);
    const int detected = detected_monnum_to_glyph(PM_NEWT, MALE);
    const int object = objnum_to_glyph(DAGGER);
    const int generic = GLYPH_OBJ_OFF + GENERIC_POTION;
    const int corpse = GLYPH_BODY_OFF + PM_NEWT;
    const int statue = GLYPH_STATUE_MALE_OFF + PM_NEWT;
    const int piletop = GLYPH_OBJ_PILETOP_OFF + DAGGER;
    const int terrain = cmap_to_glyph(S_room);
    const int trap = cmap_to_glyph(S_arrow_trap);
    const int unsupported = GLYPH_ZAP_OFF;
    const struct glyph_case cases[] = {
        { "monster", normal, glyph_is_normal_monster(normal),
          glyph_to_mon(normal) == PM_NEWT },
        { "pet", pet, glyph_is_pet(pet), glyph_to_mon(pet) == PM_NEWT },
        { "ridden", ridden, glyph_is_ridden_monster(ridden),
          glyph_to_mon(ridden) == PM_NEWT },
        { "detected", detected, glyph_is_detected_monster(detected),
          glyph_to_mon(detected) == PM_NEWT },
        { "object", object, glyph_is_normal_object(object),
          glyph_to_obj(object) == DAGGER },
        { "generic", generic, glyph_is_generic_object(generic),
          glyph_to_obj(generic) == GENERIC_POTION },
        { "corpse", corpse, glyph_is_body(corpse),
          glyph_to_obj(corpse) == CORPSE
              && glyph_to_body_corpsenm(corpse) == PM_NEWT },
        { "statue", statue, glyph_is_statue(statue),
          glyph_to_obj(statue) == STATUE
              && glyph_to_statue_corpsenm(statue) == PM_NEWT },
        { "piletop", piletop, glyph_is_normal_piletop_obj(piletop),
          glyph_to_obj(piletop) == DAGGER },
        { "terrain", terrain, is_intended_terrain(terrain),
          glyph_to_cmap(terrain) == S_room },
        { "trap", trap, glyph_is_trap(trap),
          glyph_to_trap(trap) == ARROW_TRAP },
        { "unsupported", unsupported,
          glyph_is_cmap_zap(unsupported)
              && !is_intended_terrain(unsupported),
          !glyph_is_monster(unsupported) && !glyph_is_object(unsupported)
              && !glyph_is_trap(unsupported) },
    };
    unsigned i;

    for (i = 0; i < SIZE(cases); ++i) {
        print_case(&cases[i]);
        if (!cases[i].classified || !cases[i].identity)
            return 1;
    }
    return 0;
}
