// Colour grading through the 3D LUT of the frame's grade (MASTERPROMPT §6.1 pass 9, M5-14;
// src/render/post/grading.ts). DH_LUT_SIZE nodes per axis; the colour is mapped onto the node centres so
// trilinear filtering interpolates between exactly the nodes the generator wrote.
vec3 gradeLut(sampler3D lut, vec3 c) {
  vec3 uvw = clamp(c, 0.0, 1.0) * ((DH_LUT_SIZE - 1.0) / DH_LUT_SIZE) + 0.5 / DH_LUT_SIZE;
  return texture(lut, uvw).rgb;
}
