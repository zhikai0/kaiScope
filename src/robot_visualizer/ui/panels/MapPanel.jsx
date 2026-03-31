import { useState } from 'react'
import { useMapStore } from '../store/mapStore'
import { useSimStore } from '../store/simStore'
import './MapPanel.css'

const LAYERS = [
  { id: 'satellite', label: 'Satellite' },
  { id: 'street',    label: 'Street' },
  { id: 'arcgis',    label: 'ArcGIS' },
]

export default function MapPanel() {
  const mapEnabled  = useMapStore(s => s.mapEnabled)
  const mapLayer    = useMapStore(s => s.mapLayer)
  const mapOpacity  = useMapStore(s => s.mapOpacity)
  const longitude   = useMapStore(s => s.longitude)
  const latitude    = useMapStore(s => s.latitude)
  const markers     = useMapStore(s => s.markers)
  const setMapEnabled  = useMapStore(s => s.setMapEnabled)
  const setMapLayer    = useMapStore(s => s.setMapLayer)
  const setMapOpacity  = useMapStore(s => s.setMapOpacity)
  const flyTo          = useMapStore(s => s.flyTo)
  const addMarker      = useMapStore(s => s.addMarker)
  const clearMarkers   = useMapStore(s => s.clearMarkers)

  const [lngInput, setLngInput] = useState(longitude.toFixed(4))
  const [latInput, setLatInput] = useState(latitude.toFixed(4))
  const [hInput,   setHInput]   = useState('500')

  const handleFly = () => {
    const lng = parseFloat(lngInput)
    const lat = parseFloat(latInput)
    const h   = parseFloat(hInput) || 500
    if (!isNaN(lng) && !isNaN(lat)) flyTo(lng, lat, h)
  }

  const handleAddMarker = () => {
    const lng = parseFloat(lngInput)
    const lat = parseFloat(latInput)
    if (!isNaN(lng) && !isNaN(lat)) addMarker(lng, lat, `Marker ${markers.length + 1}`)
  }

  return (
    <div className="map-panel">
      {/* Toggle */}
      <div className="mp-row">
        <span className="mp-label">Satellite Map</span>
        <label className="toggle">
          <input type="checkbox" checked={mapEnabled} onChange={e => setMapEnabled(e.target.checked)} />
          <span className="toggle-track"><span className="toggle-thumb" /></span>
        </label>
      </div>

      {/* Layer selector */}
      <div className="mp-section-label">Map Layer</div>
      <div className="mp-btn-group">
        {LAYERS.map(l => (
          <button key={l.id}
            className={`mp-btn ${mapLayer === l.id ? 'active' : ''}`}
            onClick={() => setMapLayer(l.id)}
          >{l.label}</button>
        ))}
      </div>

      {/* Opacity */}
      <div className="mp-section-label">
        Opacity
        <span className="mp-val">{Math.round(mapOpacity * 100)}%</span>
      </div>
      <input type="range" min={0} max={1} step={0.05} value={mapOpacity}
        onChange={e => setMapOpacity(parseFloat(e.target.value))} />

      {/* Fly to coordinates */}
      <div className="mp-section-label">Camera Location</div>
      <div className="mp-coord-grid">
        <div className="mp-input-wrap">
          <span className="mp-input-label">LNG</span>
          <input className="mp-input" type="number" step="0.0001"
            value={lngInput} onChange={e => setLngInput(e.target.value)} />
        </div>
        <div className="mp-input-wrap">
          <span className="mp-input-label">LAT</span>
          <input className="mp-input" type="number" step="0.0001"
            value={latInput} onChange={e => setLatInput(e.target.value)} />
        </div>
        <div className="mp-input-wrap">
          <span className="mp-input-label">ALT(m)</span>
          <input className="mp-input" type="number" step="50"
            value={hInput} onChange={e => setHInput(e.target.value)} />
        </div>
      </div>
      <div className="mp-action-row">
        <button className="mp-action-btn" onClick={handleFly}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          Fly To
        </button>
        <button className="mp-action-btn" onClick={handleAddMarker}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          Add Pin
        </button>
      </div>

      {/* Markers list */}
      {markers.length > 0 && (
        <>
          <div className="mp-section-label">
            Markers ({markers.length})
            <button className="mp-clear" onClick={clearMarkers}>Clear</button>
          </div>
          <div className="mp-markers">
            {markers.map(m => (
              <div key={m.id} className="mp-marker-item">
                <span className="mp-marker-dot" />
                <span className="mp-marker-label">{m.label}</span>
                <span className="mp-marker-coord">{m.lat.toFixed(4)}, {m.lng.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
