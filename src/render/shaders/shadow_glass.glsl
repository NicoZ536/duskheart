// Glass in the sun's path (M5-05): the light a pane of colour `pane` lets through – its hue at full brightness, lifted
// a little towards white (DH_GLASS_WHITEN) and dimmed to DH_GLASS_TRANSMISSION, so a stained-glass window throws
// clear red, blue, green and gold onto the floor and a clear pane barely darkens the sun.

vec3 glassThrough(vec3 pane) {
  float peak = max(max(pane.r, pane.g), pane.b);
  if (!(peak > 0.0)) return vec3(0.0);
  return mix(pane / peak, vec3(1.0), DH_GLASS_WHITEN) * DH_GLASS_TRANSMISSION;
}
