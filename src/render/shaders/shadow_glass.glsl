// Glass in the sun's path (M5-05): the light a pane of colour `pane` lets through – its hue at full brightness to the
// power DH_GLASS_DENSITY (M5-68, Beer–Lambert: the sun passes the pigment more than the painted colour shows it – nearly
// the pure hue of stained glass), lifted towards white by DH_GLASS_WHITEN (0 since M5-58) and dimmed to
// DH_GLASS_TRANSMISSION, so a stained-glass window throws clear red, blue, green and gold onto the floor. Clear glass
// does not come here: its panes let the sun through grey (shadow_block.frag, DH_GLASS_CLEAR_*). Mirrors
// `glassThrough` in src/render/light/glass.ts.

// One channel `c` of a pane whose brightest channel is `peak` (> 0): the scalar core of `glassThrough`.
float glassChannel(float c, float peak) {
  return mix(pow(c / peak, DH_GLASS_DENSITY), 1.0, DH_GLASS_WHITEN) * DH_GLASS_TRANSMISSION;
}

vec3 glassThrough(vec3 pane) {
  float peak = max(max(pane.r, pane.g), pane.b);
  if (!(peak > 0.0)) return vec3(0.0);
  return vec3(glassChannel(pane.r, peak), glassChannel(pane.g, peak), glassChannel(pane.b, peak));
}
