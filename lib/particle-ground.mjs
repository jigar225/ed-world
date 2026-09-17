/** Triangle interpolation matching terrainGLB's two triangles per grid cell. */
export function particleGroundHeight(surface,x,y){
  const u=((x-surface.position[0])/surface.extentMeters[0]+.5)*(surface.width-1);
  const v=((y-surface.position[1])/surface.extentMeters[1]+.5)*(surface.height-1);
  if(u<0||v<0||u>surface.width-1||v>surface.height-1)return null;
  const ix=Math.min(surface.width-2,Math.floor(u)),iy=Math.min(surface.height-2,Math.floor(v)),fx=u-ix,fy=v-iy,e=surface.elevations,w=surface.width;
  const a=e[iy*w+ix],b=e[iy*w+ix+1],c=e[(iy+1)*w+ix],d=e[(iy+1)*w+ix+1];
  return surface.position[2]+(fx+fy<=1?a+(b-a)*fx+(c-a)*fy:d+(c-d)*(1-fx)+(b-d)*(1-fy));
}
