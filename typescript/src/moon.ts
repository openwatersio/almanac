// L1 lunar theory: MOON2 (Improved Lunar Ephemeris 1954 / Brown, as published in
// Montenbruck & Pfleger, "Astronomy on the Personal Computer").
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts. The term
// tables below are copied verbatim from that file; operation order is preserved
// so a Swift port agrees bit-for-bit.
//
// INTERNAL: not part of the curated public API (see index.ts).

import {
    ARC, EARTH_EQUATORIAL_RADIUS_AU, PI2, PrecessDirection, Vec3,
    eclipticToEquatorial, frac, gyration, meanObliquityDeg, precession
} from './nutation.js';

/** Geocentric ecliptic-of-date position of the Moon; angles in radians. */
export interface MoonEcliptic { geoEclipLon: number; geoEclipLat: number; distanceAu: number; }

/**
 * UPSTREAM: `CalcMoon`, astronomy.ts lines 1494-1793 — the full MOON2 series.
 * Returns ecliptic longitude/latitude of date (radians) and distance (AU).
 */
export function calcMoon(tt: number): MoonEcliptic {
    const T = tt / 36525;

    interface PascalArray1 {
        min: number;
        array: number[];
    }

    interface PascalArray2 {
        min: number;
        array: PascalArray1[];
    }

    function DeclareArray1(xmin: number, xmax: number): PascalArray1 {
        const array = [];
        let i: number;
        for (i=0; i <= xmax-xmin; ++i) {
            array.push(0);
        }
        return {min:xmin, array:array};
    }

    function DeclareArray2(xmin: number, xmax: number, ymin: number, ymax: number): PascalArray2 {
        const array = [];
        for (let i=0; i <= xmax-xmin; ++i) {
            array.push(DeclareArray1(ymin, ymax));
        }
        return {min:xmin, array:array};
    }

    function ArrayGet2(a: PascalArray2, x: number, y: number) {
        const m = a.array[x - a.min];
        return m.array[y - m.min];
    }

    function ArraySet2(a: PascalArray2, x: number, y: number, v: number) {
        const m = a.array[x - a.min];
        m.array[y - m.min] = v;
    }

    let S: number, MAX: number, ARG: number, FAC: number, I: number, J: number, T2: number, DGAM: number, DLAM: number, N: number, GAM1C: number, SINPI: number, L0: number, L: number, LS: number, F: number, D: number, DL0: number, DL: number, DLS: number, DF: number, DD: number, DS: number;
    let coArray = DeclareArray2(-6, 6, 1, 4);
    let siArray = DeclareArray2(-6, 6, 1, 4);

    function CO(x: number, y: number) {
        return ArrayGet2(coArray, x, y);
    }

    function SI(x: number, y: number) {
        return ArrayGet2(siArray, x, y);
    }

    function SetCO(x: number, y: number, v: number) {
        return ArraySet2(coArray, x, y, v);
    }

    function SetSI(x: number, y: number, v: number) {
        return ArraySet2(siArray, x, y, v);
    }

    type ThetaFunc = (real:number, imag:number) => void;

    function AddThe(c1: number, s1: number, c2: number, s2: number, func:ThetaFunc): void {
        func(c1*c2 - s1*s2, s1*c2 + c1*s2);
    }

    function Sine(phi: number): number {
        return Math.sin(PI2 * phi);
    }
    T2 = T*T;
    DLAM = 0;
    DS = 0;
    GAM1C = 0;
    SINPI = 3422.7000;

    var S1 = Sine(0.19833+0.05611*T);
    var S2 = Sine(0.27869+0.04508*T);
    var S3 = Sine(0.16827-0.36903*T);
    var S4 = Sine(0.34734-5.37261*T);
    var S5 = Sine(0.10498-5.37899*T);
    var S6 = Sine(0.42681-0.41855*T);
    var S7 = Sine(0.14943-5.37511*T);
    DL0 = 0.84*S1+0.31*S2+14.27*S3+ 7.26*S4+ 0.28*S5+0.24*S6;
    DL  = 2.94*S1+0.31*S2+14.27*S3+ 9.34*S4+ 1.12*S5+0.83*S6;
    DLS =-6.40*S1                                   -1.89*S6;
    DF  = 0.21*S1+0.31*S2+14.27*S3-88.70*S4-15.30*S5+0.24*S6-1.86*S7;
    DD  = DL0-DLS;
    DGAM  = (-3332E-9 * Sine(0.59734-5.37261*T)
              -539E-9 * Sine(0.35498-5.37899*T)
               -64E-9 * Sine(0.39943-5.37511*T));

    L0 = PI2*frac(0.60643382+1336.85522467*T-0.00000313*T2) + DL0/ARC;
    L  = PI2*frac(0.37489701+1325.55240982*T+0.00002565*T2) + DL /ARC;
    LS = PI2*frac(0.99312619+  99.99735956*T-0.00000044*T2) + DLS/ARC;
    F  = PI2*frac(0.25909118+1342.22782980*T-0.00000892*T2) + DF /ARC;
    D  = PI2*frac(0.82736186+1236.85308708*T-0.00000397*T2) + DD /ARC;
    for (I=1; I<=4; ++I) {
        switch (I) {
            case 1: ARG=L;  MAX=4; FAC=1.000002208;               break;
            case 2: ARG=LS; MAX=3; FAC=0.997504612-0.002495388*T; break;
            case 3: ARG=F;  MAX=4; FAC=1.000002708+139.978*DGAM;  break;
            case 4: ARG=D;  MAX=6; FAC=1.0;                       break;
            default: throw `Internal error: I = ${I}`;      // persuade TypeScript that ARG, ... are all initialized before use.
        }
        SetCO(0, I, 1);
        SetCO(1, I, Math.cos(ARG) * FAC);
        SetSI(0, I, 0);
        SetSI(1, I, Math.sin(ARG) * FAC);
        for (J=2; J<=MAX; ++J) {
            AddThe(CO(J-1,I), SI(J-1,I), CO(1,I), SI(1,I), (c:number, s:number) => (SetCO(J,I,c), SetSI(J,I,s)));
        }
        for (J=1; J<=MAX; ++J) {
            SetCO(-J, I, CO(J, I));
            SetSI(-J, I, -SI(J, I));
        }
    }

    interface ComplexValue {
        x: number;
        y: number;
    }

    function Term(p: number, q: number, r: number, s: number): ComplexValue {
        var result = { x:1, y:0 };
        var I = [ 0, p, q, r, s ];      // I[0] is not used; it is a placeholder
        for (var k=1; k <= 4; ++k)
            if (I[k] !== 0)
                AddThe(result.x, result.y, CO(I[k], k), SI(I[k], k), (c:number, s:number) => (result.x=c, result.y=s));
        return result;
    }

    function AddSol(coeffl: number, coeffs: number, coeffg: number, coeffp: number, p: number, q: number, r: number, s: number): void {
        var result = Term(p, q, r, s);
        DLAM += coeffl * result.y;
        DS += coeffs * result.y;
        GAM1C += coeffg * result.x;
        SINPI += coeffp * result.x;
    }


    AddSol(    13.9020,    14.0600,    -0.0010,     0.2607, 0, 0, 0, 4);
    AddSol(     0.4030,    -4.0100,     0.3940,     0.0023, 0, 0, 0, 3);
    AddSol(  2369.9120,  2373.3600,     0.6010,    28.2333, 0, 0, 0, 2);
    AddSol(  -125.1540,  -112.7900,    -0.7250,    -0.9781, 0, 0, 0, 1);
    AddSol(     1.9790,     6.9800,    -0.4450,     0.0433, 1, 0, 0, 4);
    AddSol(   191.9530,   192.7200,     0.0290,     3.0861, 1, 0, 0, 2);
    AddSol(    -8.4660,   -13.5100,     0.4550,    -0.1093, 1, 0, 0, 1);
    AddSol( 22639.5000, 22609.0700,     0.0790,   186.5398, 1, 0, 0, 0);
    AddSol(    18.6090,     3.5900,    -0.0940,     0.0118, 1, 0, 0,-1);
    AddSol( -4586.4650, -4578.1300,    -0.0770,    34.3117, 1, 0, 0,-2);
    AddSol(     3.2150,     5.4400,     0.1920,    -0.0386, 1, 0, 0,-3);
    AddSol(   -38.4280,   -38.6400,     0.0010,     0.6008, 1, 0, 0,-4);
    AddSol(    -0.3930,    -1.4300,    -0.0920,     0.0086, 1, 0, 0,-6);
    AddSol(    -0.2890,    -1.5900,     0.1230,    -0.0053, 0, 1, 0, 4);
    AddSol(   -24.4200,   -25.1000,     0.0400,    -0.3000, 0, 1, 0, 2);
    AddSol(    18.0230,    17.9300,     0.0070,     0.1494, 0, 1, 0, 1);
    AddSol(  -668.1460,  -126.9800,    -1.3020,    -0.3997, 0, 1, 0, 0);
    AddSol(     0.5600,     0.3200,    -0.0010,    -0.0037, 0, 1, 0,-1);
    AddSol(  -165.1450,  -165.0600,     0.0540,     1.9178, 0, 1, 0,-2);
    AddSol(    -1.8770,    -6.4600,    -0.4160,     0.0339, 0, 1, 0,-4);
    AddSol(     0.2130,     1.0200,    -0.0740,     0.0054, 2, 0, 0, 4);
    AddSol(    14.3870,    14.7800,    -0.0170,     0.2833, 2, 0, 0, 2);
    AddSol(    -0.5860,    -1.2000,     0.0540,    -0.0100, 2, 0, 0, 1);
    AddSol(   769.0160,   767.9600,     0.1070,    10.1657, 2, 0, 0, 0);
    AddSol(     1.7500,     2.0100,    -0.0180,     0.0155, 2, 0, 0,-1);
    AddSol(  -211.6560,  -152.5300,     5.6790,    -0.3039, 2, 0, 0,-2);
    AddSol(     1.2250,     0.9100,    -0.0300,    -0.0088, 2, 0, 0,-3);
    AddSol(   -30.7730,   -34.0700,    -0.3080,     0.3722, 2, 0, 0,-4);
    AddSol(    -0.5700,    -1.4000,    -0.0740,     0.0109, 2, 0, 0,-6);
    AddSol(    -2.9210,   -11.7500,     0.7870,    -0.0484, 1, 1, 0, 2);
    AddSol(     1.2670,     1.5200,    -0.0220,     0.0164, 1, 1, 0, 1);
    AddSol(  -109.6730,  -115.1800,     0.4610,    -0.9490, 1, 1, 0, 0);
    AddSol(  -205.9620,  -182.3600,     2.0560,     1.4437, 1, 1, 0,-2);
    AddSol(     0.2330,     0.3600,     0.0120,    -0.0025, 1, 1, 0,-3);
    AddSol(    -4.3910,    -9.6600,    -0.4710,     0.0673, 1, 1, 0,-4);
    AddSol(     0.2830,     1.5300,    -0.1110,     0.0060, 1,-1, 0, 4);
    AddSol(    14.5770,    31.7000,    -1.5400,     0.2302, 1,-1, 0, 2);
    AddSol(   147.6870,   138.7600,     0.6790,     1.1528, 1,-1, 0, 0);
    AddSol(    -1.0890,     0.5500,     0.0210,     0.0000, 1,-1, 0,-1);
    AddSol(    28.4750,    23.5900,    -0.4430,    -0.2257, 1,-1, 0,-2);
    AddSol(    -0.2760,    -0.3800,    -0.0060,    -0.0036, 1,-1, 0,-3);
    AddSol(     0.6360,     2.2700,     0.1460,    -0.0102, 1,-1, 0,-4);
    AddSol(    -0.1890,    -1.6800,     0.1310,    -0.0028, 0, 2, 0, 2);
    AddSol(    -7.4860,    -0.6600,    -0.0370,    -0.0086, 0, 2, 0, 0);
    AddSol(    -8.0960,   -16.3500,    -0.7400,     0.0918, 0, 2, 0,-2);
    AddSol(    -5.7410,    -0.0400,     0.0000,    -0.0009, 0, 0, 2, 2);
    AddSol(     0.2550,     0.0000,     0.0000,     0.0000, 0, 0, 2, 1);
    AddSol(  -411.6080,    -0.2000,     0.0000,    -0.0124, 0, 0, 2, 0);
    AddSol(     0.5840,     0.8400,     0.0000,     0.0071, 0, 0, 2,-1);
    AddSol(   -55.1730,   -52.1400,     0.0000,    -0.1052, 0, 0, 2,-2);
    AddSol(     0.2540,     0.2500,     0.0000,    -0.0017, 0, 0, 2,-3);
    AddSol(     0.0250,    -1.6700,     0.0000,     0.0031, 0, 0, 2,-4);
    AddSol(     1.0600,     2.9600,    -0.1660,     0.0243, 3, 0, 0, 2);
    AddSol(    36.1240,    50.6400,    -1.3000,     0.6215, 3, 0, 0, 0);
    AddSol(   -13.1930,   -16.4000,     0.2580,    -0.1187, 3, 0, 0,-2);
    AddSol(    -1.1870,    -0.7400,     0.0420,     0.0074, 3, 0, 0,-4);
    AddSol(    -0.2930,    -0.3100,    -0.0020,     0.0046, 3, 0, 0,-6);
    AddSol(    -0.2900,    -1.4500,     0.1160,    -0.0051, 2, 1, 0, 2);
    AddSol(    -7.6490,   -10.5600,     0.2590,    -0.1038, 2, 1, 0, 0);
    AddSol(    -8.6270,    -7.5900,     0.0780,    -0.0192, 2, 1, 0,-2);
    AddSol(    -2.7400,    -2.5400,     0.0220,     0.0324, 2, 1, 0,-4);
    AddSol(     1.1810,     3.3200,    -0.2120,     0.0213, 2,-1, 0, 2);
    AddSol(     9.7030,    11.6700,    -0.1510,     0.1268, 2,-1, 0, 0);
    AddSol(    -0.3520,    -0.3700,     0.0010,    -0.0028, 2,-1, 0,-1);
    AddSol(    -2.4940,    -1.1700,    -0.0030,    -0.0017, 2,-1, 0,-2);
    AddSol(     0.3600,     0.2000,    -0.0120,    -0.0043, 2,-1, 0,-4);
    AddSol(    -1.1670,    -1.2500,     0.0080,    -0.0106, 1, 2, 0, 0);
    AddSol(    -7.4120,    -6.1200,     0.1170,     0.0484, 1, 2, 0,-2);
    AddSol(    -0.3110,    -0.6500,    -0.0320,     0.0044, 1, 2, 0,-4);
    AddSol(     0.7570,     1.8200,    -0.1050,     0.0112, 1,-2, 0, 2);
    AddSol(     2.5800,     2.3200,     0.0270,     0.0196, 1,-2, 0, 0);
    AddSol(     2.5330,     2.4000,    -0.0140,    -0.0212, 1,-2, 0,-2);
    AddSol(    -0.3440,    -0.5700,    -0.0250,     0.0036, 0, 3, 0,-2);
    AddSol(    -0.9920,    -0.0200,     0.0000,     0.0000, 1, 0, 2, 2);
    AddSol(   -45.0990,    -0.0200,     0.0000,    -0.0010, 1, 0, 2, 0);
    AddSol(    -0.1790,    -9.5200,     0.0000,    -0.0833, 1, 0, 2,-2);
    AddSol(    -0.3010,    -0.3300,     0.0000,     0.0014, 1, 0, 2,-4);
    AddSol(    -6.3820,    -3.3700,     0.0000,    -0.0481, 1, 0,-2, 2);
    AddSol(    39.5280,    85.1300,     0.0000,    -0.7136, 1, 0,-2, 0);
    AddSol(     9.3660,     0.7100,     0.0000,    -0.0112, 1, 0,-2,-2);
    AddSol(     0.2020,     0.0200,     0.0000,     0.0000, 1, 0,-2,-4);
    AddSol(     0.4150,     0.1000,     0.0000,     0.0013, 0, 1, 2, 0);
    AddSol(    -2.1520,    -2.2600,     0.0000,    -0.0066, 0, 1, 2,-2);
    AddSol(    -1.4400,    -1.3000,     0.0000,     0.0014, 0, 1,-2, 2);
    AddSol(     0.3840,    -0.0400,     0.0000,     0.0000, 0, 1,-2,-2);
    AddSol(     1.9380,     3.6000,    -0.1450,     0.0401, 4, 0, 0, 0);
    AddSol(    -0.9520,    -1.5800,     0.0520,    -0.0130, 4, 0, 0,-2);
    AddSol(    -0.5510,    -0.9400,     0.0320,    -0.0097, 3, 1, 0, 0);
    AddSol(    -0.4820,    -0.5700,     0.0050,    -0.0045, 3, 1, 0,-2);
    AddSol(     0.6810,     0.9600,    -0.0260,     0.0115, 3,-1, 0, 0);
    AddSol(    -0.2970,    -0.2700,     0.0020,    -0.0009, 2, 2, 0,-2);
    AddSol(     0.2540,     0.2100,    -0.0030,     0.0000, 2,-2, 0,-2);
    AddSol(    -0.2500,    -0.2200,     0.0040,     0.0014, 1, 3, 0,-2);
    AddSol(    -3.9960,     0.0000,     0.0000,     0.0004, 2, 0, 2, 0);
    AddSol(     0.5570,    -0.7500,     0.0000,    -0.0090, 2, 0, 2,-2);
    AddSol(    -0.4590,    -0.3800,     0.0000,    -0.0053, 2, 0,-2, 2);
    AddSol(    -1.2980,     0.7400,     0.0000,     0.0004, 2, 0,-2, 0);
    AddSol(     0.5380,     1.1400,     0.0000,    -0.0141, 2, 0,-2,-2);
    AddSol(     0.2630,     0.0200,     0.0000,     0.0000, 1, 1, 2, 0);
    AddSol(     0.4260,     0.0700,     0.0000,    -0.0006, 1, 1,-2,-2);
    AddSol(    -0.3040,     0.0300,     0.0000,     0.0003, 1,-1, 2, 0);
    AddSol(    -0.3720,    -0.1900,     0.0000,    -0.0027, 1,-1,-2, 2);
    AddSol(     0.4180,     0.0000,     0.0000,     0.0000, 0, 0, 4, 0);
    AddSol(    -0.3300,    -0.0400,     0.0000,     0.0000, 3, 0, 2, 0);


    function ADDN(coeffn: number, p: number, q: number, r: number, s: number) {
        return coeffn * Term(p, q, r, s).y;
    }

    N = 0;
    N += ADDN(-526.069, 0, 0,1,-2);
    N += ADDN(  -3.352, 0, 0,1,-4);
    N += ADDN( +44.297,+1, 0,1,-2);
    N += ADDN(  -6.000,+1, 0,1,-4);
    N += ADDN( +20.599,-1, 0,1, 0);
    N += ADDN( -30.598,-1, 0,1,-2);
    N += ADDN( -24.649,-2, 0,1, 0);
    N += ADDN(  -2.000,-2, 0,1,-2);
    N += ADDN( -22.571, 0,+1,1,-2);
    N += ADDN( +10.985, 0,-1,1,-2);

    DLAM += (
        +0.82*Sine(0.7736  -62.5512*T)+0.31*Sine(0.0466 -125.1025*T)
        +0.35*Sine(0.5785  -25.1042*T)+0.66*Sine(0.4591+1335.8075*T)
        +0.64*Sine(0.3130  -91.5680*T)+1.14*Sine(0.1480+1331.2898*T)
        +0.21*Sine(0.5918+1056.5859*T)+0.44*Sine(0.5784+1322.8595*T)
        +0.24*Sine(0.2275   -5.7374*T)+0.28*Sine(0.2965   +2.6929*T)
        +0.33*Sine(0.3132   +6.3368*T)
    );

    S = F + DS/ARC;

    let lat_seconds = (1.000002708 + 139.978*DGAM)*(18518.511+1.189+GAM1C)*Math.sin(S) - 6.24*Math.sin(3*S) + N;

    return {
        geoEclipLon: PI2 * frac((L0+DLAM/ARC) / PI2),
        geoEclipLat: (Math.PI / (180 * 3600)) * lat_seconds,
        distanceAu: (ARC * EARTH_EQUATORIAL_RADIUS_AU) / (0.999953253 * SINPI)
    };
}

/**
 * UPSTREAM: `GeoMoon`, astronomy.ts lines 3049-3068, followed by the
 * `gyration(..., From2000)` that `Equator(ofdate=true)` (line 2803) applies.
 *
 * `GeoVector(Body.Moon, ...)` returns `GeoMoon` unchanged whatever the
 * `aberration` flag: the Moon shares the Earth's orbital velocity, so its
 * geocentric aberration and its 1.3-second light time both fall far below the
 * precision of this lunar theory.
 *
 * The precession round trip (into J2000, then back out inside `gyration`) is
 * upstream's own composition and is kept so the Swift port can be a
 * line-for-line translation.
 *
 * @returns geocentric position in AU, J2000 mean equator (EQJ) — the `mpos2`
 * intermediate below, exported for the L2 topocentric path (Task 11), which
 * needs the body vector in the same EQJ frame as the observer's geocentric
 * position before subtracting the two.
 */
export function moonGeoVectorEqj(tt: number): Vec3 {
    const moon = calcMoon(tt);

    // Convert geocentric ecliptic spherical coords to cartesian coords.
    const dist_cos_lat = moon.distanceAu * Math.cos(moon.geoEclipLat);
    const gepos: Vec3 = {
        x: dist_cos_lat * Math.cos(moon.geoEclipLon),
        y: dist_cos_lat * Math.sin(moon.geoEclipLon),
        z: moon.distanceAu * Math.sin(moon.geoEclipLat)
    };

    // Convert ecliptic coordinates to equatorial coordinates, both in mean equinox of date.
    const mpos1 = eclipticToEquatorial(meanObliquityDeg(tt), gepos);

    // Convert from mean equinox of date to J2000...
    return precession(mpos1, tt, PrecessDirection.Into2000);
}

/**
 * UPSTREAM: `GeoMoon` (astronomy.ts 3049-3068) followed by the
 * `gyration(..., From2000)` that `Equator(ofdate=true)` (line 2803) applies.
 *
 * @returns geocentric position in AU, true equator & equinox of date.
 */
export function moonGeoVector(tt: number): Vec3 {
    // ...out to the true equator and equinox of date (precession + nutation).
    return gyration(moonGeoVectorEqj(tt), tt, PrecessDirection.From2000);
}
