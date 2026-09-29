import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '@/theme/tokens';
import { OpenStreetMapProvider } from './map-provider';
import type { ScoutingMapData } from './scouting-types';
import { useLanguage } from '@/localization/use-language';
import { translate } from '@/localization/resources';

export function ScoutingMap({ data, onObservationPress, onZonePress, onDronePress, onBoundaryPointPress, onSensorPress, onSensorLocationPress }: { data: ScoutingMapData; onObservationPress(id: string): void; onZonePress?(id: string): void; onDronePress?(): void; onBoundaryPointPress?(point: { latitude: number; longitude: number }): void; onSensorPress?(id: string): void; onSensorLocationPress?(point: { latitude: number; longitude: number }): void }) {
  const language = useLanguage();
  const [tilesUnavailable, setTilesUnavailable] = useState(false);
  const sanitized = useMemo(() => new OpenStreetMapProvider().createViewData(data), [data]);
  const html = useMemo(() => buildHtml(sanitized), [sanitized]);
  return <View style={styles.wrap}>
    <WebView originWhitelist={['*']} source={{ html }} javaScriptEnabled onMessage={(event) => {
      const value = event.nativeEvent.data;
      if (value === 'tiles-unavailable') setTilesUnavailable(true);
      else if (value === 'tiles-available') setTilesUnavailable(false);
      else if (value.startsWith('observation:')) onObservationPress(value.slice('observation:'.length));
      else if (value.startsWith('zone:')) onZonePress?.(value.slice('zone:'.length));
      else if (value === 'drone') onDronePress?.();
      else if (value.startsWith('sensor:')) onSensorPress?.(value.slice('sensor:'.length));
      else if (value.startsWith('sensor-place:')) { const [latitude, longitude] = value.slice('sensor-place:'.length).split(',').map(Number); if (Number.isFinite(latitude) && Number.isFinite(longitude)) onSensorLocationPress?.({ latitude, longitude }); }
      else if (value.startsWith('boundary:')) { const [latitude, longitude] = value.slice('boundary:'.length).split(',').map(Number); if (Number.isFinite(latitude) && Number.isFinite(longitude)) onBoundaryPointPress?.({ latitude, longitude }); }
    }} style={styles.map} />
    {tilesUnavailable ? <View pointerEvents="none" style={styles.tileNotice}><Text style={styles.noticeText}>{translate(language, 'mapTilesUnavailable')}</Text><Text style={styles.noticeText}>{translate(language, 'mapDataStillShown')}</Text></View> : null}
    {data.drawingBoundary || data.placingSensorId ? <View pointerEvents="none" style={styles.drawNotice}><Text style={styles.noticeText}>{translate(language, data.drawingBoundary ? 'drawBoundary' : 'placeSensorMapHelp')}</Text></View> : null}
    <Text style={styles.attribution}>© OpenStreetMap contributors</Text>
  </View>;
}

function buildHtml(data: ScoutingMapData) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>html,body,canvas{margin:0;width:100%;height:100%;overflow:hidden;background:#edf0e7}canvas{display:block}</style></head><body><canvas id="map"></canvas><script>
const d=${json},canvas=document.getElementById('map'),ctx=canvas.getContext('2d');let tileFailureCount=0,tilesLoaded=0,project;
function send(v){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(v)}
function world(p,z){const s=256*Math.pow(2,z),lat=Math.max(-85.0511,Math.min(85.0511,p.latitude))*Math.PI/180;return{x:(p.longitude+180)/360*s,y:(1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*s}}
function validAll(){return [...(d.boundary||[]),...(d.draftPoints||[]),...d.observations,...d.track,...(d.zones||[]).map(z=>z.center),...(d.sensorLocations||[]),...(d.dronePosition?[d.dronePosition]:[]),...(d.seedCenter?[d.seedCenter]:[])]}
let zoom=18,centerX=0,centerY=0,viewWidth=0,viewHeight=0;
function paint(){const ratio=window.devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;viewWidth=w;viewHeight=h;canvas.width=w*ratio;canvas.height=h*ratio;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.fillStyle='#edf0e7';ctx.fillRect(0,0,w,h);const points=validAll();if(!points.length){ctx.fillStyle='#526457';ctx.font='15px sans-serif';ctx.textAlign='center';ctx.fillText('No mapped field data',w/2,h/2);return}let z=18,projected;while(z>=2){projected=points.map(p=>world(p,z));const xs=projected.map(p=>p.x),ys=projected.map(p=>p.y);if(Math.max(...xs)-Math.min(...xs)<=w*.78&&Math.max(...ys)-Math.min(...ys)<=h*.72)break;z--}zoom=z;projected=points.map(p=>world(p,z));const xs=projected.map(p=>p.x),ys=projected.map(p=>p.y);centerX=(Math.min(...xs)+Math.max(...xs))/2;centerY=(Math.min(...ys)+Math.max(...ys))/2;const cx=centerX,cy=centerY;project=p=>{const q=world(p,z);return{x:w/2+q.x-cx,y:h/2+q.y-cy}};
const left=cx-w/2,top=cy-h/2;for(let x=Math.floor(left/256);x<=Math.floor((cx+w/2)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((cy+h/2)/256);y++){const img=new Image();img.onload=()=>{tilesLoaded++;send('tiles-available');ctx.globalAlpha=.85;ctx.drawImage(img,x*256-left,y*256-top,256,256);ctx.globalAlpha=1;paintVectors()};img.onerror=()=>{tileFailureCount++;if(tileFailureCount>=2)send('tiles-unavailable')};img.src='https://tile.openstreetmap.org/'+z+'/'+x+'/'+y+'.png'}setTimeout(()=>{if(!tilesLoaded)send('tiles-unavailable')},5000);paintVectors();
function paintVectors(){if(d.boundary&&d.boundary.length>=3){ctx.beginPath();d.boundary.forEach((p,i)=>{const q=project(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.closePath();ctx.fillStyle='#477a5033';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#315b3c';ctx.stroke()}if(d.draftPoints&&d.draftPoints.length){ctx.beginPath();d.draftPoints.forEach((p,i)=>{const q=project(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});if(!d.drawingBoundary&&d.draftPoints.length>=3)ctx.closePath();ctx.lineWidth=3;ctx.strokeStyle='#245d43';ctx.stroke();for(const p of d.draftPoints){const q=project(p);ctx.beginPath();ctx.arc(q.x,q.y,5,0,Math.PI*2);ctx.fillStyle='#245d43';ctx.fill()}}if(d.track.length>1){ctx.beginPath();d.track.forEach((p,i)=>{const q=project(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.lineWidth=3;ctx.strokeStyle='#367caf';ctx.stroke()}for(const zone of d.zones||[]){const q=project(zone.center);ctx.beginPath();ctx.arc(q.x,q.y,17,0,Math.PI*2);ctx.fillStyle='#bf853044';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#bf8530';ctx.stroke()}for(const marker of d.observations){const q=project(marker);ctx.beginPath();ctx.arc(q.x,q.y,9,0,Math.PI*2);ctx.fillStyle=marker.category==='healthy_looking'?'#438154':marker.category==='possible_issue'||marker.category==='needs_verification'?'#bf8530':'#6b7780';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke()}for(const sensor of d.sensorLocations||[]){const q=project(sensor);ctx.beginPath();ctx.arc(q.x,q.y,8,0,Math.PI*2);ctx.fillStyle='#245d43';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke()}if(d.dronePosition){const q=project(d.dronePosition);ctx.save();ctx.translate(q.x,q.y);ctx.rotate((d.dronePosition.heading||0)*Math.PI/180);ctx.beginPath();ctx.moveTo(0,-12);ctx.lineTo(8,9);ctx.lineTo(0,5);ctx.lineTo(-8,9);ctx.closePath();ctx.fillStyle='#2878a8';ctx.fill();ctx.restore()}}
}
canvas.onclick=e=>{if(!project)return;const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;if(d.drawingBoundary||d.placingSensorId){const worldSize=256*Math.pow(2,zoom),gx=centerX+x-viewWidth/2,gy=centerY+y-viewHeight/2,longitude=gx/worldSize*360-180,latitude=Math.atan(Math.sinh(Math.PI*(1-2*gy/worldSize)))*180/Math.PI;send((d.placingSensorId?'sensor-place:':'boundary:')+latitude+','+longitude);return}for(const sensor of d.sensorLocations||[]){const p=project(sensor);if(Math.hypot(x-p.x,y-p.y)<18){send('sensor:'+sensor.sensorId);return}}for(const marker of d.observations){const p=project(marker);if(Math.hypot(x-p.x,y-p.y)<17&&marker.observationId){send('observation:'+marker.observationId);return}}for(const zone of d.zones||[]){const p=project(zone.center);if(Math.hypot(x-p.x,y-p.y)<21){send('zone:'+zone.id);return}}if(d.dronePosition){const p=project(d.dronePosition);if(Math.hypot(x-p.x,y-p.y)<22){send('drone');return}}};window.addEventListener('resize',paint);paint();
</script></body></html>`;
}

const styles = StyleSheet.create({ wrap: { height: 310, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.surfaceSoft }, map: { flex: 1, backgroundColor: colors.surfaceSoft }, tileNotice: { position: 'absolute', bottom: 22, alignSelf: 'center', backgroundColor: '#fffffff0', borderRadius: 14, paddingHorizontal: 11, paddingVertical: 7 }, drawNotice: { position: 'absolute', top: 8, alignSelf: 'center', backgroundColor: '#fffffff0', borderRadius: 14, paddingHorizontal: 11, paddingVertical: 7 }, noticeText: { color: colors.muted, fontSize: 11 }, attribution: { position: 'absolute', bottom: 3, right: 5, paddingHorizontal: 4, backgroundColor: '#ffffffcc', color: colors.ink, fontSize: 9 } });
