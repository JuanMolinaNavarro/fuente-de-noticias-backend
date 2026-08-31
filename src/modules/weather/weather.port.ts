/**
 * Puerto: el contrato que el dominio necesita del "proveedor de clima",
 * y nada más (interfaz mínima). Quién lo cumple (Open-Meteo hoy, otro
 * servicio mañana) es un detalle de infraestructura intercambiable.
 */
export interface CurrentWeather {
  temperature: number;
  weatherCode: number;
}

export interface WeatherProviderPort {
  getCurrent(): Promise<CurrentWeather>;
}

/** Token de inyección: los services dependen de esto, no del adaptador concreto. */
export const WEATHER_PROVIDER = Symbol('WEATHER_PROVIDER');
