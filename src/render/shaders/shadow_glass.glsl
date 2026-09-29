// Glass in the sun's path (M5-05): the light a pane of colour `pane` lets through – its hue at full brightness, lifted
// towards white by DH_GLASS_WHITEN (0 since M5-58: the pure hue) and dimmed to DH_GLASS_TRANSMISSION, so a
// stained-glass window throws clear red, blue, green and gold onto the floor. Clear glass does not come here: its panes
// let the sun through grey (shadow_block.frag, DH_GLASS_CLEAR_*).

vec3 glassThrough(vec3 pane) {
  float peak = max(max(pane.r, pane.g), pane.b);
  if (!(peak > 0.0)) return vec3(0.0);
  return mix(pane / peak, vec3(1.0), DH_GLASS_WHITEN) * DH_GLASS_TRANSMISSION;
}
