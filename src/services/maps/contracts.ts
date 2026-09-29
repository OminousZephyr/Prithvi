import type { Boundary, GeoPoint } from '@/domain/models';

export interface MapFeature { id: string; kind: 'farm' | 'field' | 'sensor' | 'drone' | 'observation' | 'alert' | 'health_zone'; title: string; point?: GeoPoint; boundary?: Boundary; properties?: Record<string, string> }
export interface MapProvider { renderFeatures(features: MapFeature[]): unknown; isAvailable(): boolean }
