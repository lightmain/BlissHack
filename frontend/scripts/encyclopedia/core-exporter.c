/*
 * BlissHack alpha-2.4 host encyclopedia exporter.
 *
 * This program is compiled against the active NetHack source tree. It reads
 * the same initialized tables as the game and writes one JSON value to
 * stdout. The Node generator owns publication, hashing, and chunking.
 */

#include "config.h"
#include "weight.h"
#include "permonst.h"
#include "wintype.h"
#include "sym.h"
#include "rm.h"
#include "obj.h"
#include "prop.h"
#include "skills.h"
#include "color.h"
#include "objclass.h"
#include "artifact.h"
#include "dungeon.h"
#include "trap.h"
#include "display.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum artifacts_nums {
#define ARTI_ENUM
#include "artilist.h"
#undef ARTI_ENUM
    AFTER_LAST_ARTIFACT
};

enum misc_arti_nums {
    NROFARTIFACTS = (AFTER_LAST_ARTIFACT - 1)
};

#include "artilist.h"

struct enum_name {
    int value;
    const char *name;
};

struct flag_name {
    unsigned long mask;
    const char *name;
};

#define ARRAY_SIZE(value) (sizeof(value) / sizeof((value)[0]))
#define ENUM_ENTRY(value) { value, #value }
#define FLAG_ENTRY(value) { value, #value }

#define MON(nam, sym, lvl, gen, atk, siz, mr1, mr2, flg1, flg2, flg3, d, \
            col, bn) { PM_##bn, "PM_" #bn }
static const struct enum_name monster_names[] = {
#include "monsters.h"
};
#undef MON

#define DUMP_ENUMS
static const struct enum_name object_names[] = {
#include "objects.h"
};
#undef DUMP_ENUMS

#define DUMP_ARTI_ENUM
static const struct enum_name artifact_names[] = {
#include "artilist.h"
};
#undef DUMP_ARTI_ENUM

#define DUMP_ENUMS_PCHAR
static const struct enum_name terrain_names[] = {
#include "defsym.h"
};
#undef DUMP_ENUMS_PCHAR

#define DUMP_ENUMS_MONSYMS
static const struct enum_name monster_class_names[] = {
#include "defsym.h"
};
#undef DUMP_ENUMS_MONSYMS

#define DUMP_ENUMS_OBJCLASS_CLASSES
static const struct enum_name object_class_names[] = {
#include "defsym.h"
};
#undef DUMP_ENUMS_OBJCLASS_CLASSES

static const struct enum_name attack_type_names[] = {
    ENUM_ENTRY(AT_NONE), ENUM_ENTRY(AT_CLAW), ENUM_ENTRY(AT_BITE),
    ENUM_ENTRY(AT_KICK), ENUM_ENTRY(AT_BUTT), ENUM_ENTRY(AT_TUCH),
    ENUM_ENTRY(AT_STNG), ENUM_ENTRY(AT_HUGS), ENUM_ENTRY(AT_SPIT),
    ENUM_ENTRY(AT_ENGL), ENUM_ENTRY(AT_BREA), ENUM_ENTRY(AT_EXPL),
    ENUM_ENTRY(AT_BOOM), ENUM_ENTRY(AT_GAZE), ENUM_ENTRY(AT_TENT),
    ENUM_ENTRY(AT_WEAP), ENUM_ENTRY(AT_MAGC),
};

static const struct enum_name damage_type_names[] = {
    ENUM_ENTRY(AD_PHYS), ENUM_ENTRY(AD_MAGM), ENUM_ENTRY(AD_FIRE),
    ENUM_ENTRY(AD_COLD), ENUM_ENTRY(AD_SLEE), ENUM_ENTRY(AD_DISN),
    ENUM_ENTRY(AD_ELEC), ENUM_ENTRY(AD_DRST), ENUM_ENTRY(AD_ACID),
    ENUM_ENTRY(AD_SPC1), ENUM_ENTRY(AD_SPC2), ENUM_ENTRY(AD_BLND),
    ENUM_ENTRY(AD_STUN), ENUM_ENTRY(AD_SLOW), ENUM_ENTRY(AD_PLYS),
    ENUM_ENTRY(AD_DRLI), ENUM_ENTRY(AD_DREN), ENUM_ENTRY(AD_LEGS),
    ENUM_ENTRY(AD_STON), ENUM_ENTRY(AD_STCK), ENUM_ENTRY(AD_SGLD),
    ENUM_ENTRY(AD_SITM), ENUM_ENTRY(AD_SEDU), ENUM_ENTRY(AD_TLPT),
    ENUM_ENTRY(AD_RUST), ENUM_ENTRY(AD_CONF), ENUM_ENTRY(AD_DGST),
    ENUM_ENTRY(AD_HEAL), ENUM_ENTRY(AD_WRAP), ENUM_ENTRY(AD_WERE),
    ENUM_ENTRY(AD_DRDX), ENUM_ENTRY(AD_DRCO), ENUM_ENTRY(AD_DRIN),
    ENUM_ENTRY(AD_DISE), ENUM_ENTRY(AD_DCAY), ENUM_ENTRY(AD_SSEX),
    ENUM_ENTRY(AD_HALU), ENUM_ENTRY(AD_DETH), ENUM_ENTRY(AD_PEST),
    ENUM_ENTRY(AD_FAMN), ENUM_ENTRY(AD_SLIM), ENUM_ENTRY(AD_ENCH),
    ENUM_ENTRY(AD_CORR), ENUM_ENTRY(AD_POLY), ENUM_ENTRY(AD_CLRC),
    ENUM_ENTRY(AD_SPEL), ENUM_ENTRY(AD_RBRE), ENUM_ENTRY(AD_SAMU),
    ENUM_ENTRY(AD_CURS),
};

static const struct enum_name material_names[] = {
    ENUM_ENTRY(NO_MATERIAL), ENUM_ENTRY(LIQUID), ENUM_ENTRY(WAX),
    ENUM_ENTRY(VEGGY), ENUM_ENTRY(FLESH), ENUM_ENTRY(PAPER),
    ENUM_ENTRY(CLOTH), ENUM_ENTRY(LEATHER), ENUM_ENTRY(WOOD),
    ENUM_ENTRY(BONE), ENUM_ENTRY(DRAGON_HIDE), ENUM_ENTRY(IRON),
    ENUM_ENTRY(METAL), ENUM_ENTRY(COPPER), ENUM_ENTRY(SILVER),
    ENUM_ENTRY(GOLD), ENUM_ENTRY(PLATINUM), ENUM_ENTRY(MITHRIL),
    ENUM_ENTRY(PLASTIC), ENUM_ENTRY(GLASS), ENUM_ENTRY(GEMSTONE),
    ENUM_ENTRY(MINERAL),
};

static const struct enum_name armor_type_names[] = {
    ENUM_ENTRY(ARM_SUIT), ENUM_ENTRY(ARM_SHIELD), ENUM_ENTRY(ARM_HELM),
    ENUM_ENTRY(ARM_GLOVES), ENUM_ENTRY(ARM_BOOTS), ENUM_ENTRY(ARM_CLOAK),
    ENUM_ENTRY(ARM_SHIRT),
};

static const struct enum_name size_names[] = {
    ENUM_ENTRY(MZ_TINY), ENUM_ENTRY(MZ_SMALL), ENUM_ENTRY(MZ_MEDIUM),
    ENUM_ENTRY(MZ_LARGE), ENUM_ENTRY(MZ_HUGE), ENUM_ENTRY(MZ_GIGANTIC),
};

static const struct enum_name sound_names[] = {
    ENUM_ENTRY(MS_SILENT), ENUM_ENTRY(MS_BARK), ENUM_ENTRY(MS_MEW),
    ENUM_ENTRY(MS_ROAR), ENUM_ENTRY(MS_BELLOW), ENUM_ENTRY(MS_GROWL),
    ENUM_ENTRY(MS_SQEEK), ENUM_ENTRY(MS_SQAWK), ENUM_ENTRY(MS_CHIRP),
    ENUM_ENTRY(MS_HISS), ENUM_ENTRY(MS_BUZZ), ENUM_ENTRY(MS_GRUNT),
    ENUM_ENTRY(MS_NEIGH), ENUM_ENTRY(MS_MOO), ENUM_ENTRY(MS_WAIL),
    ENUM_ENTRY(MS_GURGLE), ENUM_ENTRY(MS_BURBLE), ENUM_ENTRY(MS_TRUMPET),
    ENUM_ENTRY(MS_SHRIEK), ENUM_ENTRY(MS_BONES), ENUM_ENTRY(MS_LAUGH),
    ENUM_ENTRY(MS_MUMBLE), ENUM_ENTRY(MS_IMITATE), ENUM_ENTRY(MS_WERE),
    ENUM_ENTRY(MS_ORC), ENUM_ENTRY(MS_HUMANOID), ENUM_ENTRY(MS_ARREST),
    ENUM_ENTRY(MS_SOLDIER), ENUM_ENTRY(MS_GUARD), ENUM_ENTRY(MS_DJINNI),
    ENUM_ENTRY(MS_NURSE), ENUM_ENTRY(MS_SEDUCE), ENUM_ENTRY(MS_VAMPIRE),
    ENUM_ENTRY(MS_BRIBE), ENUM_ENTRY(MS_CUSS), ENUM_ENTRY(MS_RIDER),
    ENUM_ENTRY(MS_LEADER), ENUM_ENTRY(MS_NEMESIS), ENUM_ENTRY(MS_GUARDIAN),
    ENUM_ENTRY(MS_SELL), ENUM_ENTRY(MS_ORACLE), ENUM_ENTRY(MS_PRIEST),
    ENUM_ENTRY(MS_SPELL), ENUM_ENTRY(MS_BOAST), ENUM_ENTRY(MS_GROAN),
};

static const struct enum_name skill_names[] = {
    ENUM_ENTRY(P_NONE), ENUM_ENTRY(P_DAGGER), ENUM_ENTRY(P_KNIFE),
    ENUM_ENTRY(P_AXE), ENUM_ENTRY(P_PICK_AXE), ENUM_ENTRY(P_SHORT_SWORD),
    ENUM_ENTRY(P_BROAD_SWORD), ENUM_ENTRY(P_LONG_SWORD),
    ENUM_ENTRY(P_TWO_HANDED_SWORD), ENUM_ENTRY(P_SABER),
    ENUM_ENTRY(P_CLUB), ENUM_ENTRY(P_MACE), ENUM_ENTRY(P_MORNING_STAR),
    ENUM_ENTRY(P_FLAIL), ENUM_ENTRY(P_HAMMER), ENUM_ENTRY(P_QUARTERSTAFF),
    ENUM_ENTRY(P_POLEARMS), ENUM_ENTRY(P_SPEAR), ENUM_ENTRY(P_TRIDENT),
    ENUM_ENTRY(P_LANCE), ENUM_ENTRY(P_BOW), ENUM_ENTRY(P_SLING),
    ENUM_ENTRY(P_CROSSBOW), ENUM_ENTRY(P_DART), ENUM_ENTRY(P_SHURIKEN),
    ENUM_ENTRY(P_BOOMERANG), ENUM_ENTRY(P_WHIP),
    ENUM_ENTRY(P_UNICORN_HORN), ENUM_ENTRY(P_ATTACK_SPELL),
    ENUM_ENTRY(P_HEALING_SPELL), ENUM_ENTRY(P_DIVINATION_SPELL),
    ENUM_ENTRY(P_ENCHANTMENT_SPELL), ENUM_ENTRY(P_CLERIC_SPELL),
    ENUM_ENTRY(P_ESCAPE_SPELL), ENUM_ENTRY(P_MATTER_SPELL),
    ENUM_ENTRY(P_BARE_HANDED_COMBAT), ENUM_ENTRY(P_TWO_WEAPON_COMBAT),
    ENUM_ENTRY(P_RIDING),
};

static const struct enum_name property_names[] = {
    ENUM_ENTRY(FIRE_RES), ENUM_ENTRY(COLD_RES), ENUM_ENTRY(SLEEP_RES),
    ENUM_ENTRY(DISINT_RES), ENUM_ENTRY(SHOCK_RES), ENUM_ENTRY(POISON_RES),
    ENUM_ENTRY(ACID_RES), ENUM_ENTRY(STONE_RES), ENUM_ENTRY(DRAIN_RES),
    ENUM_ENTRY(SICK_RES), ENUM_ENTRY(INVULNERABLE), ENUM_ENTRY(ANTIMAGIC),
    ENUM_ENTRY(STUNNED), ENUM_ENTRY(CONFUSION), ENUM_ENTRY(BLINDED),
    ENUM_ENTRY(DEAF), ENUM_ENTRY(SICK), ENUM_ENTRY(STONED),
    ENUM_ENTRY(STRANGLED), ENUM_ENTRY(VOMITING), ENUM_ENTRY(GLIB),
    ENUM_ENTRY(SLIMED), ENUM_ENTRY(HALLUC), ENUM_ENTRY(HALLUC_RES),
    ENUM_ENTRY(FUMBLING), ENUM_ENTRY(WOUNDED_LEGS), ENUM_ENTRY(SLEEPY),
    ENUM_ENTRY(HUNGER), ENUM_ENTRY(SEE_INVIS), ENUM_ENTRY(TELEPAT),
    ENUM_ENTRY(WARNING), ENUM_ENTRY(WARN_OF_MON), ENUM_ENTRY(WARN_UNDEAD),
    ENUM_ENTRY(SEARCHING), ENUM_ENTRY(CLAIRVOYANT),
    ENUM_ENTRY(INFRAVISION), ENUM_ENTRY(DETECT_MONSTERS),
    ENUM_ENTRY(BLND_RES), ENUM_ENTRY(ADORNED), ENUM_ENTRY(INVIS),
    ENUM_ENTRY(DISPLACED), ENUM_ENTRY(STEALTH),
    ENUM_ENTRY(AGGRAVATE_MONSTER), ENUM_ENTRY(CONFLICT),
    ENUM_ENTRY(JUMPING), ENUM_ENTRY(TELEPORT), ENUM_ENTRY(TELEPORT_CONTROL),
    ENUM_ENTRY(LEVITATION), ENUM_ENTRY(FLYING), ENUM_ENTRY(WWALKING),
    ENUM_ENTRY(SWIMMING), ENUM_ENTRY(MAGICAL_BREATHING),
    ENUM_ENTRY(PASSES_WALLS), ENUM_ENTRY(SLOW_DIGESTION),
    ENUM_ENTRY(HALF_SPDAM), ENUM_ENTRY(HALF_PHDAM),
    ENUM_ENTRY(REGENERATION), ENUM_ENTRY(ENERGY_REGENERATION),
    ENUM_ENTRY(PROTECTION), ENUM_ENTRY(PROT_FROM_SHAPE_CHANGERS),
    ENUM_ENTRY(POLYMORPH), ENUM_ENTRY(POLYMORPH_CONTROL),
    ENUM_ENTRY(UNCHANGING), ENUM_ENTRY(FAST), ENUM_ENTRY(REFLECTING),
    ENUM_ENTRY(FREE_ACTION), ENUM_ENTRY(FIXED_ABIL), ENUM_ENTRY(LIFESAVED),
};

static const struct enum_name invoke_names[] = {
    ENUM_ENTRY(TAMING), ENUM_ENTRY(HEALING), ENUM_ENTRY(ENERGY_BOOST),
    ENUM_ENTRY(UNTRAP), ENUM_ENTRY(CHARGE_OBJ), ENUM_ENTRY(LEV_TELE),
    ENUM_ENTRY(CREATE_PORTAL), ENUM_ENTRY(ENLIGHTENING),
    ENUM_ENTRY(CREATE_AMMO), ENUM_ENTRY(BANISH), ENUM_ENTRY(FLING_POISON),
    ENUM_ENTRY(FIRESTORM), ENUM_ENTRY(SNOWSTORM), ENUM_ENTRY(BLINDING_RAY),
};

static const struct flag_name resistance_names[] = {
    FLAG_ENTRY(MR_FIRE), FLAG_ENTRY(MR_COLD), FLAG_ENTRY(MR_SLEEP),
    FLAG_ENTRY(MR_DISINT), FLAG_ENTRY(MR_ELEC), FLAG_ENTRY(MR_POISON),
    FLAG_ENTRY(MR_ACID), FLAG_ENTRY(MR_STONE),
};

static const struct flag_name generation_names[] = {
    FLAG_ENTRY(G_UNIQ), FLAG_ENTRY(G_NOHELL), FLAG_ENTRY(G_HELL),
    FLAG_ENTRY(G_NOGEN), FLAG_ENTRY(G_SGROUP), FLAG_ENTRY(G_LGROUP),
    FLAG_ENTRY(G_GENO), FLAG_ENTRY(G_NOCORPSE),
};

static const struct flag_name m1_names[] = {
    FLAG_ENTRY(M1_NOLIMBS), FLAG_ENTRY(M1_OMNIVORE), FLAG_ENTRY(M1_FLY),
    FLAG_ENTRY(M1_SWIM), FLAG_ENTRY(M1_AMORPHOUS), FLAG_ENTRY(M1_WALLWALK),
    FLAG_ENTRY(M1_CLING), FLAG_ENTRY(M1_TUNNEL), FLAG_ENTRY(M1_NEEDPICK),
    FLAG_ENTRY(M1_CONCEAL), FLAG_ENTRY(M1_HIDE), FLAG_ENTRY(M1_AMPHIBIOUS),
    FLAG_ENTRY(M1_BREATHLESS), FLAG_ENTRY(M1_NOTAKE), FLAG_ENTRY(M1_NOEYES),
    FLAG_ENTRY(M1_NOHANDS), FLAG_ENTRY(M1_NOHEAD), FLAG_ENTRY(M1_MINDLESS),
    FLAG_ENTRY(M1_HUMANOID), FLAG_ENTRY(M1_ANIMAL), FLAG_ENTRY(M1_SLITHY),
    FLAG_ENTRY(M1_UNSOLID), FLAG_ENTRY(M1_THICK_HIDE),
    FLAG_ENTRY(M1_OVIPAROUS), FLAG_ENTRY(M1_REGEN), FLAG_ENTRY(M1_SEE_INVIS),
    FLAG_ENTRY(M1_TPORT), FLAG_ENTRY(M1_TPORT_CNTRL), FLAG_ENTRY(M1_ACID),
    FLAG_ENTRY(M1_POIS), FLAG_ENTRY(M1_CARNIVORE), FLAG_ENTRY(M1_HERBIVORE),
    FLAG_ENTRY(M1_METALLIVORE),
};

static const struct flag_name m2_names[] = {
    FLAG_ENTRY(M2_NOPOLY), FLAG_ENTRY(M2_UNDEAD), FLAG_ENTRY(M2_WERE),
    FLAG_ENTRY(M2_HUMAN), FLAG_ENTRY(M2_ELF), FLAG_ENTRY(M2_DWARF),
    FLAG_ENTRY(M2_GNOME), FLAG_ENTRY(M2_ORC), FLAG_ENTRY(M2_DEMON),
    FLAG_ENTRY(M2_MERC), FLAG_ENTRY(M2_LORD), FLAG_ENTRY(M2_PRINCE),
    FLAG_ENTRY(M2_MINION), FLAG_ENTRY(M2_GIANT),
    FLAG_ENTRY(M2_SHAPESHIFTER), FLAG_ENTRY(M2_MALE), FLAG_ENTRY(M2_FEMALE),
    FLAG_ENTRY(M2_NEUTER), FLAG_ENTRY(M2_PNAME), FLAG_ENTRY(M2_HOSTILE),
    FLAG_ENTRY(M2_PEACEFUL), FLAG_ENTRY(M2_DOMESTIC), FLAG_ENTRY(M2_WANDER),
    FLAG_ENTRY(M2_STALK), FLAG_ENTRY(M2_NASTY), FLAG_ENTRY(M2_STRONG),
    FLAG_ENTRY(M2_ROCKTHROW), FLAG_ENTRY(M2_GREEDY), FLAG_ENTRY(M2_JEWELS),
    FLAG_ENTRY(M2_COLLECT), FLAG_ENTRY(M2_MAGIC),
};

static const struct flag_name m3_names[] = {
    FLAG_ENTRY(M3_WANTSAMUL), FLAG_ENTRY(M3_WANTSBELL),
    FLAG_ENTRY(M3_WANTSBOOK), FLAG_ENTRY(M3_WANTSCAND),
    FLAG_ENTRY(M3_WANTSARTI), FLAG_ENTRY(M3_WAITFORU), FLAG_ENTRY(M3_CLOSE),
    FLAG_ENTRY(M3_INFRAVISION), FLAG_ENTRY(M3_INFRAVISIBLE),
    FLAG_ENTRY(M3_DISPLACES),
};

static const struct flag_name spfx_names[] = {
    FLAG_ENTRY(SPFX_NOGEN), FLAG_ENTRY(SPFX_RESTR), FLAG_ENTRY(SPFX_INTEL),
    FLAG_ENTRY(SPFX_SPEAK), FLAG_ENTRY(SPFX_SEEK), FLAG_ENTRY(SPFX_WARN),
    FLAG_ENTRY(SPFX_ATTK), FLAG_ENTRY(SPFX_DEFN), FLAG_ENTRY(SPFX_DRLI),
    FLAG_ENTRY(SPFX_SEARCH), FLAG_ENTRY(SPFX_BEHEAD), FLAG_ENTRY(SPFX_HALRES),
    FLAG_ENTRY(SPFX_ESP), FLAG_ENTRY(SPFX_STLTH), FLAG_ENTRY(SPFX_REGEN),
    FLAG_ENTRY(SPFX_EREGEN), FLAG_ENTRY(SPFX_HSPDAM), FLAG_ENTRY(SPFX_HPHDAM),
    FLAG_ENTRY(SPFX_TCTRL), FLAG_ENTRY(SPFX_LUCK), FLAG_ENTRY(SPFX_DMONS),
    FLAG_ENTRY(SPFX_DCLAS), FLAG_ENTRY(SPFX_DFLAG1),
    FLAG_ENTRY(SPFX_DFLAG2), FLAG_ENTRY(SPFX_DALIGN), FLAG_ENTRY(SPFX_XRAY),
    FLAG_ENTRY(SPFX_REFLECT), FLAG_ENTRY(SPFX_PROTECT),
};

static const struct enum_name trap_names[] = {
    ENUM_ENTRY(ARROW_TRAP), ENUM_ENTRY(DART_TRAP), ENUM_ENTRY(ROCKTRAP),
    ENUM_ENTRY(SQKY_BOARD), ENUM_ENTRY(BEAR_TRAP), ENUM_ENTRY(LANDMINE),
    ENUM_ENTRY(ROLLING_BOULDER_TRAP), ENUM_ENTRY(SLP_GAS_TRAP),
    ENUM_ENTRY(RUST_TRAP), ENUM_ENTRY(FIRE_TRAP), ENUM_ENTRY(PIT),
    ENUM_ENTRY(SPIKED_PIT), ENUM_ENTRY(HOLE), ENUM_ENTRY(TRAPDOOR),
    ENUM_ENTRY(TELEP_TRAP), ENUM_ENTRY(LEVEL_TELEP), ENUM_ENTRY(MAGIC_PORTAL),
    ENUM_ENTRY(WEB), ENUM_ENTRY(STATUE_TRAP), ENUM_ENTRY(MAGIC_TRAP),
    ENUM_ENTRY(ANTI_MAGIC), ENUM_ENTRY(POLY_TRAP),
    ENUM_ENTRY(VIBRATING_SQUARE), ENUM_ENTRY(TRAPPED_DOOR),
    ENUM_ENTRY(TRAPPED_CHEST),
};

void monst_globals_init(void);
void objects_globals_init(void);

/**
 * Fail the exporter with a stable diagnostic.
 * @param message Description of the rejected source value.
 */
static void
fail(const char *message)
{
    fprintf(stderr, "core-exporter: %s\n", message);
    exit(EXIT_FAILURE);
}

/**
 * Find an exact symbolic name for an enum value.
 * @param table Exhaustive enum mapping.
 * @param count Number of mapping entries.
 * @param value Value to resolve.
 * @param label Diagnostic field label.
 * @return Stable source symbol.
 */
static const char *
enum_symbol(const struct enum_name *table, size_t count, int value,
            const char *label)
{
    size_t index;

    for (index = 0; index < count; ++index)
        if (table[index].value == value)
            return table[index].name;
    fprintf(stderr, "core-exporter: unknown %s value %d\n", label, value);
    exit(EXIT_FAILURE);
}

/**
 * Write one JSON string or null.
 * @param value UTF-8 source text, or null.
 */
static void
json_string(const char *value)
{
    const unsigned char *cursor;

    if (!value) {
        fputs("null", stdout);
        return;
    }
    fputc('"', stdout);
    for (cursor = (const unsigned char *) value; *cursor; ++cursor) {
        switch (*cursor) {
        case '"':
            fputs("\\\"", stdout);
            break;
        case '\\':
            fputs("\\\\", stdout);
            break;
        case '\b':
            fputs("\\b", stdout);
            break;
        case '\f':
            fputs("\\f", stdout);
            break;
        case '\n':
            fputs("\\n", stdout);
            break;
        case '\r':
            fputs("\\r", stdout);
            break;
        case '\t':
            fputs("\\t", stdout);
            break;
        default:
            if (*cursor < 0x20)
                fprintf(stdout, "\\u%04x", (unsigned) *cursor);
            else
                fputc(*cursor, stdout);
            break;
        }
    }
    fputc('"', stdout);
}

/**
 * Write a boolean JSON literal.
 * @param value C truth value.
 */
static void
json_bool(int value)
{
    fputs(value ? "true" : "false", stdout);
}

/**
 * Write and exhaustively decode a bitmask as a symbol array.
 * @param value Source bitmask.
 * @param table Ordered symbolic masks, with composites before components.
 * @param count Number of masks.
 * @param label Diagnostic field label.
 */
static void
json_flags(unsigned long value, const struct flag_name *table, size_t count,
           const char *label)
{
    unsigned long remaining = value;
    int wrote = 0;
    size_t index;

    fputc('[', stdout);
    for (index = 0; index < count; ++index) {
        if (table[index].mask != 0
            && (remaining & table[index].mask) == table[index].mask) {
            if (wrote++)
                fputc(',', stdout);
            json_string(table[index].name);
            remaining &= ~table[index].mask;
        }
    }
    fputc(']', stdout);
    if (remaining != 0) {
        fprintf(stderr, "core-exporter: unknown %s bits 0x%lx\n", label,
                remaining);
        exit(EXIT_FAILURE);
    }
}

/**
 * Return a monster's stable PM symbol.
 * @param index mons[] index.
 * @return PM_* source symbol.
 */
static const char *
monster_symbol(int index)
{
    return enum_symbol(monster_names, ARRAY_SIZE(monster_names), index,
                       "monster");
}

/**
 * Return an object's stable enum symbol.
 * @param index objects[] index.
 * @return Object source symbol.
 */
static const char *
object_symbol(int index)
{
    return enum_symbol(object_names, ARRAY_SIZE(object_names), index,
                       "object");
}

/**
 * Return the canonical uppercase S_* terrain symbol used in entity IDs.
 * @param index S_* terrain value.
 * @return Uppercase stable symbol in exporter-owned storage.
 */
static const char *
terrain_symbol(int index)
{
    static char normalized[128];
    const char *source = enum_symbol(terrain_names, ARRAY_SIZE(terrain_names),
                                     index, "terrain");
    size_t offset;

    if (strlen(source) >= sizeof normalized)
        fail("terrain symbol exceeds exporter bound");
    for (offset = 0; source[offset]; ++offset)
        normalized[offset] = (char) toupper((unsigned char) source[offset]);
    normalized[offset] = '\0';
    return normalized;
}

/**
 * Write a stable entity ID.
 * @param prefix Entity namespace including trailing colon.
 * @param symbol Source enum symbol.
 */
static void
entity_id(const char *prefix, const char *symbol)
{
    char buffer[160];

    if (snprintf(buffer, sizeof buffer, "%s%s", prefix, symbol)
        >= (int) sizeof buffer)
        fail("entity ID exceeds exporter bound");
    json_string(buffer);
}

/**
 * Write a structured attack.
 * @param attack NetHack attack value.
 */
static void
json_attack(const struct attack *attack)
{
    fputs("{\"attackType\":", stdout);
    json_string(enum_symbol(attack_type_names, ARRAY_SIZE(attack_type_names),
                            attack->aatyp, "attack type"));
    fputs(",\"damageType\":", stdout);
    json_string(enum_symbol(damage_type_names, ARRAY_SIZE(damage_type_names),
                            attack->adtyp, "damage type"));
    fprintf(stdout, ",\"dice\":{\"count\":%u,\"sides\":%u}}",
            (unsigned) attack->damn, (unsigned) attack->damd);
}

/**
 * Resolve a monster size without accepting unused enum gaps.
 * @param value msize value.
 * @return MZ_* symbol.
 */
static const char *
size_symbol(int value)
{
    return enum_symbol(size_names, ARRAY_SIZE(size_names), value,
                       "monster size");
}

/**
 * Resolve a monster sound enum.
 * @param value msound value.
 * @return MS_* symbol.
 */
static const char *
sound_symbol(int value)
{
    return enum_symbol(sound_names, ARRAY_SIZE(sound_names), value,
                       "monster sound");
}

/**
 * Resolve alignment to its stable source symbol.
 * @param value NetHack alignment.
 * @return A_* symbol.
 */
static const char *
alignment_symbol(int value)
{
    switch (value) {
    case A_NONE:
        return "A_NONE";
    case A_CHAOTIC:
        return "A_CHAOTIC";
    case A_NEUTRAL:
        return "A_NEUTRAL";
    case A_LAWFUL:
        return "A_LAWFUL";
    default:
        fail("unknown alignment");
        return 0;
    }
}

/**
 * Return a golem's fixed initial HP.
 * @param index mons[] index.
 * @return Fixed HP, or zero for a non-golem.
 */
static int
golem_hit_points(int index)
{
    switch (index) {
    case PM_STRAW_GOLEM:
    case PM_PAPER_GOLEM:
        return 20;
    case PM_ROPE_GOLEM:
        return 30;
    case PM_LEATHER_GOLEM:
    case PM_FLESH_GOLEM:
        return 40;
    case PM_WOOD_GOLEM:
        return 50;
    case PM_GOLD_GOLEM:
        return 60;
    case PM_CLAY_GOLEM:
        return 70;
    case PM_GLASS_GOLEM:
        return 80;
    case PM_STONE_GOLEM:
        return 100;
    case PM_IRON_GOLEM:
        return 120;
    default:
        return 0;
    }
}

/**
 * Test whether a monster receives the home-elemental HP multiplier.
 * @param index mons[] index.
 * @return Non-zero for one of the four elemental species.
 */
static int
is_home_elemental_species(int index)
{
    return index == PM_AIR_ELEMENTAL || index == PM_FIRE_ELEMENTAL
           || index == PM_EARTH_ELEMENTAL || index == PM_WATER_ELEMENTAL;
}

/**
 * Write the source-faithful initial HP rule for a monster.
 * @param index mons[] index.
 * @param monster Initialized monster record.
 */
static void
json_hp_rule(int index, const struct permonst *monster)
{
    int fixed_hp = golem_hit_points(index);

    if (fixed_hp) {
        fprintf(stdout, "{\"kind\":\"golem-fixed\",\"hitPoints\":%d}",
                fixed_hp);
    } else if (index == PM_DEATH || index == PM_FAMINE
               || index == PM_PESTILENCE) {
        fputs("{\"kind\":\"rider\",\"dice\":{\"count\":10,\"sides\":8},"
              "\"minimumRollBoost\":true}", stdout);
    } else if (monster->mlevel > 49) {
        fprintf(stdout,
                "{\"kind\":\"special-fixed\",\"encodedLevel\":%d,"
                "\"hitPoints\":%d,\"effectiveLevel\":%d}",
                (int) monster->mlevel, 2 * ((int) monster->mlevel - 6),
                (2 * ((int) monster->mlevel - 6)) / 4);
    } else if (monster->mlet == S_DRAGON && index >= PM_GRAY_DRAGON) {
        fprintf(stdout,
                "{\"kind\":\"adult-dragon\",\"baseLevel\":%d,"
                "\"normalMultiplier\":4,\"normalBonusDieSides\":4,"
                "\"endgameMultiplier\":8}",
                (int) monster->mlevel);
    } else {
        fprintf(stdout,
                "{\"kind\":\"ordinary\",\"baseLevel\":%d,"
                "\"zeroLevelDieSides\":4,\"positiveLevelDieSides\":8,"
                "\"homeMultiplier\":%d,\"minimumRollBoost\":true}",
                (int) monster->mlevel,
                is_home_elemental_species(index) ? 3 : 1);
    }
}

/**
 * Write one monster catalog record.
 * @param index mons[] index.
 */
static void
json_monster(int index)
{
    const struct permonst *monster = &mons[index];
    const char *symbol = monster_symbol(index);
    const char *primary_name = monster->pmnames[MALE]
                                   ? monster->pmnames[MALE]
                                   : (monster->pmnames[NEUTRAL]
                                          ? monster->pmnames[NEUTRAL]
                                          : monster->pmnames[FEMALE]);
    int attack_index;
    int wrote_attack = 0;

    fputs("{\"schemaVersion\":1,\"id\":", stdout);
    entity_id("monster:", symbol);
    fputs(",\"kind\":\"monster\",\"names\":{\"primary\":", stdout);
    json_string(primary_name);
    if (monster->pmnames[FEMALE]
        && strcmp(monster->pmnames[FEMALE], primary_name)) {
        fputs(",\"female\":", stdout);
        json_string(monster->pmnames[FEMALE]);
    }
    if (monster->pmnames[NEUTRAL]
        && strcmp(monster->pmnames[NEUTRAL], primary_name)) {
        fputs(",\"neutral\":", stdout);
        json_string(monster->pmnames[NEUTRAL]);
    }
    fprintf(stdout, "},\"symbol\":%d,\"color\":%u,\"facts\":{",
            (int) monster->mlet, (unsigned) monster->mcolor);
    fputs("\"monsterClass\":", stdout);
    json_string(enum_symbol(monster_class_names,
                            ARRAY_SIZE(monster_class_names), monster->mlet,
                            "monster class"));
    fprintf(stdout,
            ",\"level\":%d,\"difficulty\":%u,\"speed\":%d,"
            "\"armorClass\":%d,\"magicResistance\":%d,\"alignment\":%d",
            (int) monster->mlevel, (unsigned) monster->difficulty,
            (int) monster->mmove, (int) monster->ac, (int) monster->mr,
            (int) monster->maligntyp);
    fprintf(stdout, ",\"generation\":{\"frequency\":%u,\"flags\":",
            (unsigned) (monster->geno & G_FREQ));
    json_flags(monster->geno & ~G_FREQ, generation_names,
               ARRAY_SIZE(generation_names), "generation");
    fputs("},\"attacks\":[", stdout);
    for (attack_index = 0; attack_index < NATTK; ++attack_index) {
        const struct attack *attack = &monster->mattk[attack_index];

        if (attack->aatyp == AT_NONE && attack->adtyp == AD_PHYS
            && attack->damn == 0 && attack->damd == 0)
            continue;
        if (wrote_attack++)
            fputc(',', stdout);
        json_attack(attack);
    }
    fputs("],\"hpRule\":", stdout);
    json_hp_rule(index, monster);
    fputs(",\"size\":", stdout);
    json_string(size_symbol(monster->msize));
    fprintf(stdout, ",\"weight\":%u,\"nutrition\":%u,\"sound\":",
            monster->cwt, (unsigned) monster->cnutrit);
    json_string(sound_symbol(monster->msound));
    fputs(",\"resistances\":", stdout);
    json_flags(monster->mresists, resistance_names,
               ARRAY_SIZE(resistance_names), "resistance");
    fputs(",\"conveys\":", stdout);
    json_flags(monster->mconveys, resistance_names,
               ARRAY_SIZE(resistance_names), "conveyed resistance");
    fputs(",\"flags\":{\"m1\":", stdout);
    json_flags(monster->mflags1, m1_names, ARRAY_SIZE(m1_names), "mflags1");
    fputs(",\"m2\":", stdout);
    json_flags(monster->mflags2, m2_names, ARRAY_SIZE(m2_names), "mflags2");
    fputs(",\"m3\":", stdout);
    json_flags(monster->mflags3, m3_names, ARRAY_SIZE(m3_names), "mflags3");
    fputs("},\"corpse\":{\"exists\":", stdout);
    json_bool(!(monster->geno & G_NOCORPSE));
    fprintf(stdout, ",\"weight\":%u,\"nutrition\":%u}",
            monster->cwt, (unsigned) monster->cnutrit);
    if (index == PM_NEWT) {
        fputs(",\"specialEffects\":[{\"kind\":\"corpse-energy\","
              "\"chanceNumerator\":2,\"chanceDenominator\":3,"
              "\"guaranteedWhen\":{\"currentEnergyMultiplier\":3,"
              "\"operator\":\"less-than-or-equal\","
              "\"maximumEnergyMultiplier\":2},"
              "\"energyDice\":{\"count\":1,\"sides\":3},"
              "\"overflowCondition\":\"energy-exceeds-maximum\","
              "\"overflowMaximumEnergyChanceNumerator\":1,"
              "\"overflowMaximumEnergyChanceDenominator\":3,"
              "\"sourceRef\":{\"path\":\"src/eat.c\","
              "\"symbol\":\"eye_of_newt_buzz\"}}]", stdout);
    }
    fputs("},\"sourceRefs\":[{\"path\":\"include/monsters.h\",\"symbol\":",
          stdout);
    json_string(symbol);
    fputs("},{\"path\":\"src/makemon.c\",\"symbol\":\"newmonhp\"}]}", stdout);
}

/**
 * Resolve an object class symbol.
 * @param value oc_class value.
 * @return *_CLASS source symbol.
 */
static const char *
object_class_symbol(int value)
{
    return enum_symbol(object_class_names, ARRAY_SIZE(object_class_names),
                       value, "object class");
}

/**
 * Write one generic object-class appearance without a concrete object effect.
 * @param index objects[] generic index below FIRST_OBJECT.
 */
static void
json_appearance(int index)
{
    const struct objclass *object = &objects[index];
    const char *class_symbol = object_class_symbol(object->oc_class);
    char appearance_id[160];

    if (snprintf(appearance_id, sizeof appearance_id, "appearance:%s:GENERIC",
                 class_symbol)
        >= (int) sizeof appearance_id)
        fail("appearance ID exceeds exporter bound");
    fputs("{\"schemaVersion\":1,\"id\":", stdout);
    json_string(appearance_id);
    fputs(",\"kind\":\"appearance\",\"names\":{\"primary\":", stdout);
    json_string(obj_descr[index].oc_descr);
    fprintf(stdout, "},\"symbol\":%d,\"color\":%u,\"facts\":{\"objectClass\":",
            (int) object->oc_class, (unsigned) object->oc_color);
    json_string(class_symbol);
    fputs("},\"sourceRefs\":[{\"path\":\"include/objects.h\",\"symbol\":",
          stdout);
    json_string(object_symbol(index));
    fputs("}]}", stdout);
}

/**
 * Resolve an object material symbol.
 * @param value oc_material value.
 * @return Material enum symbol.
 */
static const char *
material_symbol(int value)
{
    return enum_symbol(material_names, ARRAY_SIZE(material_names), value,
                       "object material");
}

/**
 * Resolve a skill symbol, preserving projectile sign separately.
 * @param value Absolute skill value.
 * @return P_* source symbol.
 */
static const char *
skill_symbol(int value)
{
    return enum_symbol(skill_names, ARRAY_SIZE(skill_names), value,
                       "object skill");
}

/**
 * Write an optional property symbol.
 * @param value oc_oprop or artifact invoke property.
 */
static void
json_property(int value)
{
    if (!value)
        fputs("null", stdout);
    else
        json_string(enum_symbol(property_names, ARRAY_SIZE(property_names),
                                value, "property"));
}

/**
 * Write object-class-specific facts.
 * @param object Initialized object class record.
 */
static void
json_object_subtype(const struct objclass *object)
{
    int skill;

    if (object->oc_class == WEAPON_CLASS
        || (object->oc_class == TOOL_CLASS
            && (object->oc_wsdam || object->oc_wldam))) {
        skill = object->oc_skill;
        fputs("{\"kind\":\"weapon\",\"damageSmall\":", stdout);
        fprintf(stdout,
                "%d,\"damageLarge\":%d,\"hitBonus\":%d,\"skill\":",
                (int) object->oc_wsdam, (int) object->oc_wldam,
                (int) object->oc_hitbon);
        json_string(skill_symbol(skill < 0 ? -skill : skill));
        fputs(",\"projectile\":", stdout);
        json_bool(skill < 0);
        fputs(",\"strikeModes\":[", stdout);
        if (object->oc_dir & PIERCE)
            json_string("PIERCE");
        if (object->oc_dir & SLASH) {
            if (object->oc_dir & PIERCE)
                fputc(',', stdout);
            json_string("SLASH");
        }
        if (object->oc_dir & WHACK) {
            if (object->oc_dir & (PIERCE | SLASH))
                fputc(',', stdout);
            json_string("WHACK");
        }
        fputs("]}", stdout);
    } else if (object->oc_class == ARMOR_CLASS) {
        fputs("{\"kind\":\"armor\",\"category\":", stdout);
        json_string(enum_symbol(armor_type_names, ARRAY_SIZE(armor_type_names),
                                object->oc_armcat, "armor category"));
        fprintf(stdout, ",\"armorClass\":%d,\"magicCancellation\":%d}",
                (int) object->a_ac, (int) object->a_can);
    } else if (object->oc_class == FOOD_CLASS) {
        fprintf(stdout, "{\"kind\":\"food\",\"nutrition\":%u}",
                (unsigned) object->oc_nutrition);
    } else if (object->oc_class == SPBOOK_CLASS) {
        fputs("{\"kind\":\"spellbook\",\"skill\":", stdout);
        json_string(skill_symbol(object->oc_skill));
        fprintf(stdout, ",\"level\":%d}", (int) object->oc_level);
    } else {
        fputs("{\"kind\":\"other\"}", stdout);
    }
}

/**
 * Write one concrete object catalog record.
 * @param index objects[] index, at or after FIRST_OBJECT.
 */
static void
json_object(int index)
{
    const struct objclass *object = &objects[index];
    const char *symbol = object_symbol(index);
    const char *primary_name = obj_descr[index].oc_name
                                   ? obj_descr[index].oc_name
                                   : obj_descr[index].oc_descr;

    fputs("{\"schemaVersion\":1,\"id\":", stdout);
    entity_id("object:", symbol);
    fputs(",\"kind\":\"object\",\"names\":{\"primary\":", stdout);
    json_string(primary_name);
    if (obj_descr[index].oc_descr
        && strcmp(obj_descr[index].oc_descr, primary_name)) {
        fputs(",\"appearance\":", stdout);
        json_string(obj_descr[index].oc_descr);
    }
    fprintf(stdout, "},\"symbol\":%d,\"color\":%u,\"facts\":{",
            (int) object->oc_class, (unsigned) object->oc_color);
    fputs("\"objectClass\":", stdout);
    json_string(object_class_symbol(object->oc_class));
    fputs(",\"material\":", stdout);
    json_string(material_symbol(object->oc_material));
    fprintf(stdout,
            ",\"probability\":%d,\"weight\":%u,\"baseCost\":%d,"
            "\"useDelay\":%d,\"property\":",
            (int) object->oc_prob, object->oc_weight, (int) object->oc_cost,
            (int) object->oc_delay);
    json_property(object->oc_oprop);
    fputs(",\"flags\":{\"nameKnown\":", stdout);
    json_bool(object->oc_name_known);
    fputs(",\"merge\":", stdout);
    json_bool(object->oc_merge);
    fputs(",\"usesKnown\":", stdout);
    json_bool(object->oc_uses_known);
    fputs(",\"magic\":", stdout);
    json_bool(object->oc_magic);
    fputs(",\"charged\":", stdout);
    json_bool(object->oc_charged);
    fputs(",\"unique\":", stdout);
    json_bool(object->oc_unique);
    fputs(",\"notWishable\":", stdout);
    json_bool(object->oc_nowish);
    fputs(",\"big\":", stdout);
    json_bool(object->oc_big);
    fputs(",\"tough\":", stdout);
    json_bool(object->oc_tough);
    fputs("},\"subtype\":", stdout);
    json_object_subtype(object);
    fputs("},\"sourceRefs\":[{\"path\":\"include/objects.h\",\"symbol\":",
          stdout);
    json_string(symbol);
    fputs("}]}", stdout);
}

/**
 * Write an artifact attack/defense/carry descriptor.
 * @param attack Artifact attack value.
 */
static void
json_artifact_attack(const struct attack *attack)
{
    json_attack(attack);
}

/**
 * Resolve an invocation field as a property, special invocation, or null.
 * @param value inv_prop value.
 */
static void
json_invocation(int value)
{
    if (!value) {
        fputs("null", stdout);
    } else if (value <= LAST_PROP) {
        fputs("{\"kind\":\"property\",\"symbol\":", stdout);
        json_property(value);
        fputc('}', stdout);
    } else {
        fputs("{\"kind\":\"invoke\",\"symbol\":", stdout);
        json_string(enum_symbol(invoke_names, ARRAY_SIZE(invoke_names), value,
                                "artifact invocation"));
        fputc('}', stdout);
    }
}

/**
 * Write the typed artifact target selected by SPFX_D* flags.
 * @param artifact Initialized artifact record.
 */
static void
json_artifact_target(const struct artifact *artifact)
{
    if (artifact->spfx & SPFX_DMONS) {
        fputs("{\"kind\":\"monster\",\"symbol\":", stdout);
        json_string(monster_symbol((int) artifact->mtype));
    } else if (artifact->spfx & SPFX_DCLAS) {
        fputs("{\"kind\":\"monster-class\",\"symbol\":", stdout);
        json_string(enum_symbol(monster_class_names,
                                ARRAY_SIZE(monster_class_names),
                                (int) artifact->mtype, "artifact class target"));
    } else if (artifact->spfx & SPFX_DFLAG1) {
        fputs("{\"kind\":\"mflags1\",\"symbols\":", stdout);
        json_flags(artifact->mtype, m1_names, ARRAY_SIZE(m1_names),
                   "artifact mflags1 target");
    } else if (artifact->spfx & SPFX_DFLAG2) {
        fputs("{\"kind\":\"mflags2\",\"symbols\":", stdout);
        json_flags(artifact->mtype, m2_names, ARRAY_SIZE(m2_names),
                   "artifact mflags2 target");
    } else {
        fputs("null", stdout);
        return;
    }
    fputc('}', stdout);
}

/**
 * Write one artifact catalog record.
 * @param index artilist[] index after ART_NONARTIFACT.
 */
static void
json_artifact(int index)
{
    const struct artifact *artifact = &artilist[index];
    const char *symbol = enum_symbol(artifact_names,
                                     ARRAY_SIZE(artifact_names), index,
                                     "artifact");

    fputs("{\"schemaVersion\":1,\"id\":", stdout);
    entity_id("artifact:", symbol);
    fputs(",\"kind\":\"artifact\",\"names\":{\"primary\":", stdout);
    json_string(artifact->name);
    fputs("},\"symbol\":null,\"color\":", stdout);
    if (artifact->acolor == NO_COLOR)
        fputs("null", stdout);
    else
        fprintf(stdout, "%d", (int) artifact->acolor);
    fputs(",\"facts\":{\"baseObjectId\":", stdout);
    entity_id("object:", object_symbol(artifact->otyp));
    fputs(",\"flags\":", stdout);
    json_flags(artifact->spfx, spfx_names, ARRAY_SIZE(spfx_names),
               "artifact spfx");
    fputs(",\"carryFlags\":", stdout);
    json_flags(artifact->cspfx, spfx_names, ARRAY_SIZE(spfx_names),
               "artifact carry spfx");
    fputs(",\"target\":", stdout);
    json_artifact_target(artifact);
    fputs(",\"attack\":", stdout);
    json_artifact_attack(&artifact->attk);
    fputs(",\"defense\":", stdout);
    json_artifact_attack(&artifact->defn);
    fputs(",\"carry\":", stdout);
    json_artifact_attack(&artifact->cary);
    fputs(",\"invoke\":", stdout);
    json_invocation(artifact->inv_prop);
    fputs(",\"alignment\":", stdout);
    json_string(alignment_symbol(artifact->alignment));
    fputs(",\"role\":", stdout);
    if (artifact->role == NON_PM)
        fputs("null", stdout);
    else
        entity_id("monster:", monster_symbol(artifact->role));
    fputs(",\"race\":", stdout);
    if (artifact->race == NON_PM)
        fputs("null", stdout);
    else
        entity_id("monster:", monster_symbol(artifact->race));
    fprintf(stdout,
            ",\"generationEnchantment\":%d,\"giftValue\":%u,\"baseCost\":%ld}",
            (int) artifact->gen_spe, (unsigned) artifact->gift_value,
            artifact->cost);
    fputs(",\"sourceRefs\":[{\"path\":\"include/artilist.h\",\"symbol\":",
          stdout);
    json_string(symbol);
    fputs("}]}", stdout);
}

/**
 * Classify one persistent terrain symbol.
 * @param index S_* value from S_stone through S_water.
 * @return Stable category string.
 */
static const char *
terrain_category(int index)
{
    if (index <= S_trwall)
        return "wall";
    if (index <= S_tree)
        return "door-or-barrier";
    if (index <= S_engrcorr)
        return "floor-or-corridor";
    if (index <= S_brdnladder)
        return "stairs-or-ladder";
    if (index <= S_fountain)
        return "furniture";
    return "environment";
}

/**
 * Write one terrain catalog record.
 * @param index S_* value from S_stone through S_water.
 */
static void
json_terrain(int index)
{
    const char *symbol = terrain_symbol(index);

    fputs("{\"schemaVersion\":1,\"id\":", stdout);
    entity_id("terrain:", symbol);
    fputs(",\"kind\":\"terrain\",\"names\":{\"primary\":", stdout);
    json_string(defsyms[index].explanation);
    fprintf(stdout, "},\"symbol\":%u,\"color\":%u,\"facts\":{\"terrainSymbol\":",
            (unsigned) defsyms[index].sym, (unsigned) defsyms[index].color);
    json_string(symbol);
    fputs(",\"category\":", stdout);
    json_string(terrain_category(index));
    fputs("},\"sourceRefs\":[{\"path\":\"include/defsym.h\",\"symbol\":",
          stdout);
    json_string(symbol);
    fputs("}]}", stdout);
}

/**
 * Write one trap catalog record.
 * @param type Trap enum value from ARROW_TRAP through TRAPPED_CHEST.
 */
static void
json_trap(int type)
{
    const char *symbol = enum_symbol(trap_names, ARRAY_SIZE(trap_names), type,
                                     "trap");
    const struct symdef *display = &defsyms[S_arrow_trap + type - 1];

    fputs("{\"schemaVersion\":1,\"id\":", stdout);
    entity_id("trap:", symbol);
    fputs(",\"kind\":\"trap\",\"names\":{\"primary\":", stdout);
    json_string(display->explanation);
    fprintf(stdout,
            "},\"symbol\":%u,\"color\":%u,\"facts\":{\"trapSymbol\":",
            (unsigned) display->sym, (unsigned) display->color);
    json_string(symbol);
    fputs(",\"category\":\"trap\"},\"sourceRefs\":["
          "{\"path\":\"include/trap.h\",\"symbol\":", stdout);
    json_string(symbol);
    fputs("},{\"path\":\"include/defsym.h\",\"symbol\":", stdout);
    json_string(enum_symbol(terrain_names, ARRAY_SIZE(terrain_names),
                            S_arrow_trap + type - 1, "trap display"));
    fputs("}]}", stdout);
}

/**
 * Resolve a themed cmap glyph back to its semantic S_* value.
 * @param glyph Glyph in a cmap range.
 * @return S_* value, or -1 when the glyph is not a persistent terrain.
 */
static int
semantic_cmap(int glyph)
{
    if (glyph == GLYPH_CMAP_STONE_OFF)
        return S_stone;
    if (glyph_is_cmap_main(glyph))
        return S_vwall + glyph - GLYPH_CMAP_MAIN_OFF;
    if (glyph_is_cmap_mines(glyph))
        return S_vwall + glyph - GLYPH_CMAP_MINES_OFF;
    if (glyph_is_cmap_gehennom(glyph))
        return S_vwall + glyph - GLYPH_CMAP_GEH_OFF;
    if (glyph_is_cmap_knox(glyph))
        return S_vwall + glyph - GLYPH_CMAP_KNOX_OFF;
    if (glyph_is_cmap_sokoban(glyph))
        return S_vwall + glyph - GLYPH_CMAP_SOKO_OFF;
    if (glyph_is_cmap_a(glyph))
        return S_ndoor + glyph - GLYPH_CMAP_A_OFF;
    if (glyph_is_cmap_altar(glyph))
        return S_altar;
    if (glyph_is_cmap_b(glyph))
        return S_grave + glyph - GLYPH_CMAP_B_OFF;
    return -1;
}

/**
 * Write the common supported glyph result prefix.
 * @param glyph Glyph index.
 */
static void
supported_glyph_prefix(int glyph)
{
    fprintf(stdout, "{\"glyph\":%d,\"status\":\"supported\",\"binding\":{",
            glyph);
}

/**
 * Write an unsupported glyph result.
 * @param glyph Glyph index.
 * @param reason Stable kebab-case reason.
 */
static void
unsupported_glyph(int glyph, const char *reason)
{
    fprintf(stdout, "{\"glyph\":%d,\"status\":\"unsupported\",\"reason\":",
            glyph);
    json_string(reason);
    fputc('}', stdout);
}

/**
 * Write a monster glyph binding for one presentation range.
 * @param glyph Glyph index.
 * @param presentation monster, pet, detected, or ridden.
 */
static void
monster_glyph(int glyph, const char *presentation)
{
    const char *gender = (glyph_is_normal_female_monster(glyph)
                          || glyph_is_female_pet(glyph)
                          || glyph_is_detected_female_monster(glyph)
                          || glyph_is_ridden_female_monster(glyph))
                             ? "female"
                             : "male";

    supported_glyph_prefix(glyph);
    fputs("\"kind\":\"monster\",\"monsterId\":", stdout);
    entity_id("monster:", monster_symbol(glyph_to_mon(glyph)));
    fputs(",\"presentation\":", stdout);
    json_string(presentation);
    fputs(",\"gender\":", stdout);
    json_string(gender);
    fputs("}}", stdout);
}

/**
 * Write a corpse glyph binding.
 * @param glyph Glyph index.
 */
static void
corpse_glyph(int glyph)
{
    supported_glyph_prefix(glyph);
    fputs("\"kind\":\"corpse\",\"objectId\":\"object:CORPSE\","
          "\"monsterId\":", stdout);
    entity_id("monster:", monster_symbol(glyph_to_body_corpsenm(glyph)));
    fputs(",\"pileTop\":", stdout);
    json_bool(glyph_is_body_piletop(glyph));
    fputs("}}", stdout);
}

/**
 * Write a statue glyph binding.
 * @param glyph Glyph index.
 */
static void
statue_glyph(int glyph)
{
    supported_glyph_prefix(glyph);
    fputs("\"kind\":\"statue\",\"objectId\":\"object:STATUE\","
          "\"monsterId\":", stdout);
    entity_id("monster:", monster_symbol(glyph_to_statue_corpsenm(glyph)));
    fputs(",\"pileTop\":", stdout);
    json_bool(glyph_is_male_statue_piletop(glyph)
              || glyph_is_fem_statue_piletop(glyph));
    fputs(",\"gender\":", stdout);
    json_string((glyph_is_fem_statue(glyph)) ? "female" : "male");
    fputs("}}", stdout);
}

/**
 * Write a generic object-class glyph binding.
 * @param glyph Glyph index.
 */
static void
generic_object_glyph(int glyph)
{
    int pile_top = glyph >= GLYPH_OBJ_PILETOP_OFF
                   && glyph < GLYPH_OBJ_PILETOP_OFF + NUM_OBJECTS;
    int index = glyph
                - (pile_top ? GLYPH_OBJ_PILETOP_OFF : GLYPH_OBJ_OFF);
    const char *class_symbol = object_class_symbol(objects[index].oc_class);
    char appearance_id[160];

    if (snprintf(appearance_id, sizeof appearance_id, "appearance:%s:GENERIC",
                 class_symbol)
        >= (int) sizeof appearance_id)
        fail("appearance ID exceeds exporter bound");
    supported_glyph_prefix(glyph);
    fputs("\"kind\":\"generic-object\",\"appearanceId\":", stdout);
    json_string(appearance_id);
    fputs(",\"objectClass\":", stdout);
    json_string(class_symbol);
    fputs(",\"pileTop\":", stdout);
    json_bool(pile_top);
    fputs("}}", stdout);
}

/**
 * Write a concrete object glyph binding.
 * @param glyph Glyph index.
 */
static void
object_glyph(int glyph)
{
    int index = glyph_to_obj(glyph);
    const char *class_symbol;
    char appearance_id[160];

    if (index < FIRST_OBJECT) {
        unsupported_glyph(glyph, "non-entity-object");
        return;
    }
    if (!objects[index].oc_name_known) {
        class_symbol = object_class_symbol(objects[index].oc_class);
        if (snprintf(appearance_id, sizeof appearance_id,
                     "appearance:%s:GENERIC", class_symbol)
            >= (int) sizeof appearance_id)
            fail("appearance ID exceeds exporter bound");
        supported_glyph_prefix(glyph);
        fputs("\"kind\":\"generic-object\",\"appearanceId\":", stdout);
        json_string(appearance_id);
        fputs(",\"objectClass\":", stdout);
        json_string(class_symbol);
        fputs(",\"pileTop\":", stdout);
        json_bool(glyph_is_normal_piletop_obj(glyph));
        fputs("}}", stdout);
        return;
    }
    supported_glyph_prefix(glyph);
    fputs("\"kind\":\"object\",\"objectId\":", stdout);
    entity_id("object:", object_symbol(index));
    fputs(",\"pileTop\":", stdout);
    json_bool(glyph_is_normal_piletop_obj(glyph));
    fputs("}}", stdout);
}

/**
 * Write a trap glyph binding.
 * @param glyph Glyph index.
 */
static void
trap_glyph(int glyph)
{
    int type = glyph_to_trap(glyph);

    supported_glyph_prefix(glyph);
    fputs("\"kind\":\"trap\",\"trapId\":", stdout);
    entity_id("trap:", enum_symbol(trap_names, ARRAY_SIZE(trap_names), type,
                                    "glyph trap"));
    fputs("}}", stdout);
}

/**
 * Write a persistent terrain glyph binding.
 * @param glyph Glyph index.
 * @param terrain Semantic S_* index.
 */
static void
terrain_glyph(int glyph, int terrain)
{
    supported_glyph_prefix(glyph);
    fputs("\"kind\":\"terrain\",\"terrainId\":", stdout);
    entity_id("terrain:",
              terrain_symbol(terrain));
    fputs(",\"variant\":", stdout);
    if (glyph_is_cmap_mines(glyph))
        json_string("mines");
    else if (glyph_is_cmap_gehennom(glyph))
        json_string("gehennom");
    else if (glyph_is_cmap_knox(glyph))
        json_string("knox");
    else if (glyph_is_cmap_sokoban(glyph))
        json_string("sokoban");
    else if (glyph_is_cmap_altar(glyph))
        json_string("altar-alignment");
    else
        json_string("main");
    fputs("}}", stdout);
}

/**
 * Classify and write exactly one glyph result.
 * @param glyph Glyph index in [0, MAX_GLYPH).
 */
static void
json_glyph(int glyph)
{
    int terrain;
    int object_index = -1;

    if (glyph_is_normal_monster(glyph)) {
        monster_glyph(glyph, "monster");
    } else if (glyph_is_pet(glyph)) {
        monster_glyph(glyph, "pet");
    } else if (glyph_is_detected_monster(glyph)) {
        monster_glyph(glyph, "detected");
    } else if (glyph_is_ridden_monster(glyph)) {
        monster_glyph(glyph, "ridden");
    } else if (glyph_is_body(glyph)) {
        corpse_glyph(glyph);
    } else if (glyph_is_statue(glyph)) {
        statue_glyph(glyph);
    } else if (glyph >= GLYPH_OBJ_OFF
               && glyph < GLYPH_OBJ_OFF + NUM_OBJECTS) {
        object_index = glyph - GLYPH_OBJ_OFF;
        if (object_index > 0 && object_index < FIRST_OBJECT)
            generic_object_glyph(glyph);
        else
            object_glyph(glyph);
    } else if (glyph >= GLYPH_OBJ_PILETOP_OFF
               && glyph < GLYPH_OBJ_PILETOP_OFF + NUM_OBJECTS) {
        object_index = glyph - GLYPH_OBJ_PILETOP_OFF;
        if (object_index > 0 && object_index < FIRST_OBJECT)
            generic_object_glyph(glyph);
        else
            object_glyph(glyph);
    } else if (glyph_is_generic_object(glyph)) {
        generic_object_glyph(glyph);
    } else if (glyph_is_normal_object(glyph)) {
        object_glyph(glyph);
    } else if (glyph_is_invisible(glyph)) {
        unsupported_glyph(glyph, "invisible");
    } else if (glyph_is_cmap_zap(glyph)) {
        unsupported_glyph(glyph, "zap-effect");
    } else if (glyph_is_swallow(glyph)) {
        unsupported_glyph(glyph, "swallow-effect");
    } else if (glyph_is_explosion(glyph)) {
        unsupported_glyph(glyph, "explosion-effect");
    } else if (glyph_is_warning(glyph)) {
        unsupported_glyph(glyph, "warning");
    } else if (glyph_is_unexplored(glyph)) {
        unsupported_glyph(glyph, "unexplored");
    } else if (glyph_is_nothing(glyph)) {
        unsupported_glyph(glyph, "nothing");
    } else if (glyph_is_trap(glyph)) {
        trap_glyph(glyph);
    } else if ((terrain = semantic_cmap(glyph)) >= S_stone
               && terrain <= S_water) {
        terrain_glyph(glyph, terrain);
    } else if (glyph_is_cmap(glyph)) {
        unsupported_glyph(glyph, "temporary-cmap");
    } else {
        unsupported_glyph(glyph, "unclassified");
    }
}

/**
 * Export initialized NetHack tables as one machine-readable JSON value.
 * @return EXIT_SUCCESS on complete output.
 */
int
main(void)
{
    int index;

    monst_globals_init();
    objects_globals_init();

    fprintf(stdout, "{\"schemaVersion\":1,\"maxGlyph\":%d,\"counts\":{"
                    "\"appearance\":%d,\"monster\":%d,\"object\":%d,\"artifact\":%d,"
                    "\"terrain\":%d,\"trap\":%d},\"records\":[",
            MAX_GLYPH, FIRST_OBJECT - 1, NUMMONS, NUM_OBJECTS - FIRST_OBJECT,
            NROFARTIFACTS, S_water - S_stone + 1, TRAPNUM - 1);

    for (index = 1; index < FIRST_OBJECT; ++index) {
        if (index > 1)
            fputc(',', stdout);
        json_appearance(index);
    }
    for (index = 1; index <= NROFARTIFACTS; ++index) {
        fputc(',', stdout);
        json_artifact(index);
    }
    for (index = 0; index < NUMMONS; ++index) {
        fputc(',', stdout);
        json_monster(index);
    }
    for (index = FIRST_OBJECT; index < NUM_OBJECTS; ++index) {
        fputc(',', stdout);
        json_object(index);
    }
    for (index = S_stone; index <= S_water; ++index) {
        fputc(',', stdout);
        json_terrain(index);
    }
    for (index = ARROW_TRAP; index < TRAPNUM; ++index) {
        fputc(',', stdout);
        json_trap(index);
    }

    fputs("],\"glyphBindings\":[", stdout);
    for (index = 0; index < MAX_GLYPH; ++index) {
        if (index)
            fputc(',', stdout);
        json_glyph(index);
    }
    fputs("]}\n", stdout);
    if (ferror(stdout))
        fail("failed to write stdout");
    return EXIT_SUCCESS;
}
