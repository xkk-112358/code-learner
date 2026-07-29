import { describe, it, expect } from 'vitest';
import { detectManualMarkers, getManualMarkerConfig } from '../../parser/manual-marker';
import { CellMarker } from '../../parser/cell';

describe('detectManualMarkers', () => {
  it('detects Python # %% marker', () => {
    const lines = ['x = 1', '', '# %%', 'y = 2'];
    const config = getManualMarkerConfig('python');
    const result = detectManualMarkers(lines, config);
    expect(result.length).toBe(1);
    expect(result[0].line).toBe(2);
    expect(result[0].marker).toBe(CellMarker.MANUAL);
  });

  it('detects Python # --- marker', () => {
    const lines = ['x = 1', '# ---', 'y = 2'];
    const config = getManualMarkerConfig('python');
    const result = detectManualMarkers(lines, config);
    expect(result.length).toBe(1);
    expect(result[0].line).toBe(1);
  });

  it('detects TypeScript // %% marker', () => {
    const lines = ['const x = 1;', '', '// %%', 'const y = 2;'];
    const config = getManualMarkerConfig('typescript');
    const result = detectManualMarkers(lines, config);
    expect(result.length).toBe(1);
    expect(result[0].line).toBe(2);
    expect(result[0].marker).toBe(CellMarker.MANUAL);
  });

  it('detects // cell marker', () => {
    const lines = ['// cell', 'const x = 1;'];
    const config = getManualMarkerConfig('typescript');
    const result = detectManualMarkers(lines, config);
    expect(result.length).toBe(1);
    expect(result[0].line).toBe(0);
  });

  it('detects Java /* cell */ marker', () => {
    const lines = ['/* cell */', 'class Foo {}'];
    const config = getManualMarkerConfig('java');
    const result = detectManualMarkers(lines, config);
    expect(result.length).toBe(1);
    expect(result[0].line).toBe(0);
  });

  it('detects multiple markers in a file', () => {
    const lines = ['# %%', 'x = 1', '# ---', 'y = 2', '# %%', 'z = 3'];
    const config = getManualMarkerConfig('python');
    const result = detectManualMarkers(lines, config);
    expect(result.length).toBe(3);
  });

  it('ignores non-marker comments', () => {
    const lines = ['# this is not a marker', 'x = 1'];
    const config = getManualMarkerConfig('python');
    const result = detectManualMarkers(lines, config);
    expect(result.length).toBe(0);
  });

  it('ignores empty lines', () => {
    const lines = ['', '   ', ''];
    const config = getManualMarkerConfig('python');
    const result = detectManualMarkers(lines, config);
    expect(result.length).toBe(0);
  });

  it('case-insensitive <region> detection', () => {
    const lines = ['// <region>', 'code', '// <REGION>', 'more'];
    const config = getManualMarkerConfig('typescript');
    const result = detectManualMarkers(lines, config);
    expect(result.length).toBe(2);
  });

  it('fallback config works for unknown language', () => {
    const config = getManualMarkerConfig('unknown_language');
    expect(config.name).toBe('Generic');
    expect(config.patterns.length).toBeGreaterThan(0);
  });
});
