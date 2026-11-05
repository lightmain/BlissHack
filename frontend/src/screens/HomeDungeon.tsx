/** Properties for the decorative Home dungeon. */
interface HomeDungeonProps {
  animated?: boolean;
}

/**
 * Render the shared ASCII room shown during startup and on Home.
 * @param props - optional loading animation state.
 * @returns the decorative dungeon room.
 */
export function HomeDungeon({ animated = false }: HomeDungeonProps) {
  const className = animated
    ? "home-dungeon home-dungeon-loading"
    : "home-dungeon";

  return (
    <pre aria-hidden="true" className={className}>
      <span>|----<b>+</b>----|</span>
      <span>|....#....|</span>
      <span>|....#..<b className="home-dungeon-exit">&gt;</b>.|</span>
      <span>|....#....|</span>
      <span>|----<b>+</b>----|</span>
      <b className="home-dungeon-player">@</b>
    </pre>
  );
}
