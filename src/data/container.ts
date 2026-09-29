import { localProvider } from '@/data/providers/local-provider';
import { sensorRepository } from '@/features/sensors/sensor-repository';
import { localStore } from '@/data/storage/local-store';
import { WifiSensorProvider } from '@/features/sensors/wifi-sensor-provider';
import { LocalAIProvider } from '@/features/ai/local-ai-provider';
import { PriorityAIProvider } from '@/features/ai/priority-ai-provider';
import { MobileNetV3OnDeviceProvider } from '../features/ai/on-device/ai-runtime';
import { LocalEsp32CameraProvider } from '@/features/ai/camera-provider';
import { AIRepository } from '@/features/ai/ai-repository';
import { ObservationLocationService } from '@/features/observations/observation-location';
import { DroneRepository } from '@/features/drone/drone-repository';
import { LocalWifiDroneProvider } from '@/features/drone/local-wifi-drone-provider';
import { DroneGpsLocationProvider } from '@/features/drone/drone-location-provider';
import { ScoutingRepository } from '@/features/scouting/scouting-repository';
import { advisoryRepository } from '@/features/advisory/advisory-runtime';
import { AlertService } from '@/features/alerts/alert-service';
import { AccountService } from '@/features/account/account-service';
import { SupabaseAuthProvider } from '@/features/account/supabase-auth-provider';
import { supabaseClient } from '@/data/supabase-client';
import { SupabaseCloudRepository } from '@/features/sync/cloud-repository';
import { SyncService } from '@/features/sync/sync-service';
import { OpenMeteoProvider } from '@/features/weather/open-meteo-provider';
import { WeatherCache } from '@/features/weather/weather-cache';
import { WeatherRepository } from '@/features/weather/weather-repository';
import { NetlifyKisanMitraProvider } from '@/features/kisanmitra/kisanmitra-provider';

/** Replace this composition root with device/backend adapters as integrations arrive. */
export const appProvider = localProvider;
/** Local-network HTTP only; the ESP32 address is saved locally by the provider. */
export const sensorService = new WifiSensorProvider(sensorRepository, localStore);
export const alertService = new AlertService(localStore, {}, () => sensorService.getConnection(), () => advisoryRepository.refresh());
export const cameraProvider = new LocalEsp32CameraProvider(localStore);
export const optionalAIProvider = new LocalAIProvider(localStore);
export const onDeviceAIProvider = new MobileNetV3OnDeviceProvider();
export const aiProvider = new PriorityAIProvider(onDeviceAIProvider, optionalAIProvider, localStore);
export const aiRepository = new AIRepository(localStore);
/** No device-location source is configured yet; this provider never invents a fix. */
export const droneRepository = new DroneRepository(localStore);
/** Polls only after the farmer configures a local bridge URL or opens Drone. */
export const droneTelemetryProvider = new LocalWifiDroneProvider(droneRepository, localStore);
export const observationLocationProvider = new ObservationLocationService(new DroneGpsLocationProvider(droneRepository));
export const scoutingRepository = new ScoutingRepository(localStore, droneRepository);
export { advisoryRepository };
export const authProvider = new SupabaseAuthProvider(supabaseClient);
export const accountService = new AccountService(localStore, authProvider);
export const cloudRepository = supabaseClient ? new SupabaseCloudRepository(supabaseClient) : undefined;
export const syncService = new SyncService(localStore, localStore.queue, accountService, cloudRepository);
export const weatherRepository = new WeatherRepository(new OpenMeteoProvider(), new WeatherCache(localStore));
export const kisanMitraProvider = new NetlifyKisanMitraProvider();
