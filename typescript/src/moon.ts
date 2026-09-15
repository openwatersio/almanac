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

    let S: number, MAX: number, ARG: number, FAC: number, I: number, J: number, T2: number, DGAM: number, DLAM: number, N: number, GAM1C: number, SINPI: number, L0: number, L: number, LS: number, F: number, D: number, DL0: number, DL: number, DLS: number, DF: number, DD: number, DS: number;
    // CO/SI tables: x in -6...6, y in 1...4, stored in flat 13x4 arrays.
    const coArray = new Array<number>(52).fill(0);
    const siArray = new Array<number>(52).fill(0);

    function CO(x: number, y: number) {
        return coArray[(x + 6) * 4 + y - 1];
    }

    function SI(x: number, y: number) {
        return siArray[(x + 6) * 4 + y - 1];
    }

    function SetCO(x: number, y: number, v: number) {
        coArray[(x + 6) * 4 + y - 1] = v;
    }

    function SetSI(x: number, y: number, v: number) {
        siArray[(x + 6) * 4 + y - 1] = v;
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

    let termY = 0;

    function Term(p: number, q: number, r: number, s: number): void {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        if (p !== 0) {
            c = CO(p, 1); si = SI(p, 1);
            nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        }
        if (q !== 0) {
            c = CO(q, 2); si = SI(q, 2);
            nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        }
        if (r !== 0) {
            c = CO(r, 3); si = SI(r, 3);
            nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        }
        if (s !== 0) {
            c = CO(s, 4); si = SI(s, 4);
            nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        }
        termY = y;
    }



    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[43]; si = siArray[43];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 13.9020 * y;
        DS += 14.0600 * y;
        GAM1C += -0.0010 * x;
        SINPI += 0.2607 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[39]; si = siArray[39];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.4030 * y;
        DS += -4.0100 * y;
        GAM1C += 0.3940 * x;
        SINPI += 0.0023 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 2369.9120 * y;
        DS += 2373.3600 * y;
        GAM1C += 0.6010 * x;
        SINPI += 28.2333 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[31]; si = siArray[31];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -125.1540 * y;
        DS += -112.7900 * y;
        GAM1C += -0.7250 * x;
        SINPI += -0.9781 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[43]; si = siArray[43];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 1.9790 * y;
        DS += 6.9800 * y;
        GAM1C += -0.4450 * x;
        SINPI += 0.0433 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 191.9530 * y;
        DS += 192.7200 * y;
        GAM1C += 0.0290 * x;
        SINPI += 3.0861 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[31]; si = siArray[31];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -8.4660 * y;
        DS += -13.5100 * y;
        GAM1C += 0.4550 * x;
        SINPI += -0.1093 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 22639.5000 * y;
        DS += 22609.0700 * y;
        GAM1C += 0.0790 * x;
        SINPI += 186.5398 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[23]; si = siArray[23];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 18.6090 * y;
        DS += 3.5900 * y;
        GAM1C += -0.0940 * x;
        SINPI += 0.0118 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -4586.4650 * y;
        DS += -4578.1300 * y;
        GAM1C += -0.0770 * x;
        SINPI += 34.3117 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[15]; si = siArray[15];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 3.2150 * y;
        DS += 5.4400 * y;
        GAM1C += 0.1920 * x;
        SINPI += -0.0386 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[11]; si = siArray[11];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -38.4280 * y;
        DS += -38.6400 * y;
        GAM1C += 0.0010 * x;
        SINPI += 0.6008 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[3]; si = siArray[3];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.3930 * y;
        DS += -1.4300 * y;
        GAM1C += -0.0920 * x;
        SINPI += 0.0086 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[43]; si = siArray[43];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.2890 * y;
        DS += -1.5900 * y;
        GAM1C += 0.1230 * x;
        SINPI += -0.0053 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -24.4200 * y;
        DS += -25.1000 * y;
        GAM1C += 0.0400 * x;
        SINPI += -0.3000 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[31]; si = siArray[31];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 18.0230 * y;
        DS += 17.9300 * y;
        GAM1C += 0.0070 * x;
        SINPI += 0.1494 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -668.1460 * y;
        DS += -126.9800 * y;
        GAM1C += -1.3020 * x;
        SINPI += -0.3997 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[23]; si = siArray[23];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.5600 * y;
        DS += 0.3200 * y;
        GAM1C += -0.0010 * x;
        SINPI += -0.0037 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -165.1450 * y;
        DS += -165.0600 * y;
        GAM1C += 0.0540 * x;
        SINPI += 1.9178 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[11]; si = siArray[11];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -1.8770 * y;
        DS += -6.4600 * y;
        GAM1C += -0.4160 * x;
        SINPI += 0.0339 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[43]; si = siArray[43];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.2130 * y;
        DS += 1.0200 * y;
        GAM1C += -0.0740 * x;
        SINPI += 0.0054 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 14.3870 * y;
        DS += 14.7800 * y;
        GAM1C += -0.0170 * x;
        SINPI += 0.2833 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[31]; si = siArray[31];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.5860 * y;
        DS += -1.2000 * y;
        GAM1C += 0.0540 * x;
        SINPI += -0.0100 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 769.0160 * y;
        DS += 767.9600 * y;
        GAM1C += 0.1070 * x;
        SINPI += 10.1657 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[23]; si = siArray[23];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 1.7500 * y;
        DS += 2.0100 * y;
        GAM1C += -0.0180 * x;
        SINPI += 0.0155 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -211.6560 * y;
        DS += -152.5300 * y;
        GAM1C += 5.6790 * x;
        SINPI += -0.3039 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[15]; si = siArray[15];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 1.2250 * y;
        DS += 0.9100 * y;
        GAM1C += -0.0300 * x;
        SINPI += -0.0088 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[11]; si = siArray[11];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -30.7730 * y;
        DS += -34.0700 * y;
        GAM1C += -0.3080 * x;
        SINPI += 0.3722 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[3]; si = siArray[3];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.5700 * y;
        DS += -1.4000 * y;
        GAM1C += -0.0740 * x;
        SINPI += 0.0109 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -2.9210 * y;
        DS += -11.7500 * y;
        GAM1C += 0.7870 * x;
        SINPI += -0.0484 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[31]; si = siArray[31];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 1.2670 * y;
        DS += 1.5200 * y;
        GAM1C += -0.0220 * x;
        SINPI += 0.0164 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -109.6730 * y;
        DS += -115.1800 * y;
        GAM1C += 0.4610 * x;
        SINPI += -0.9490 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -205.9620 * y;
        DS += -182.3600 * y;
        GAM1C += 2.0560 * x;
        SINPI += 1.4437 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[15]; si = siArray[15];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.2330 * y;
        DS += 0.3600 * y;
        GAM1C += 0.0120 * x;
        SINPI += -0.0025 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[11]; si = siArray[11];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -4.3910 * y;
        DS += -9.6600 * y;
        GAM1C += -0.4710 * x;
        SINPI += 0.0673 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[21]; si = siArray[21];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[43]; si = siArray[43];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.2830 * y;
        DS += 1.5300 * y;
        GAM1C += -0.1110 * x;
        SINPI += 0.0060 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[21]; si = siArray[21];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 14.5770 * y;
        DS += 31.7000 * y;
        GAM1C += -1.5400 * x;
        SINPI += 0.2302 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[21]; si = siArray[21];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 147.6870 * y;
        DS += 138.7600 * y;
        GAM1C += 0.6790 * x;
        SINPI += 1.1528 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[21]; si = siArray[21];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[23]; si = siArray[23];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -1.0890 * y;
        DS += 0.5500 * y;
        GAM1C += 0.0210 * x;
        SINPI += 0.0000 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[21]; si = siArray[21];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 28.4750 * y;
        DS += 23.5900 * y;
        GAM1C += -0.4430 * x;
        SINPI += -0.2257 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[21]; si = siArray[21];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[15]; si = siArray[15];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.2760 * y;
        DS += -0.3800 * y;
        GAM1C += -0.0060 * x;
        SINPI += -0.0036 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[21]; si = siArray[21];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[11]; si = siArray[11];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.6360 * y;
        DS += 2.2700 * y;
        GAM1C += 0.1460 * x;
        SINPI += -0.0102 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[33]; si = siArray[33];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.1890 * y;
        DS += -1.6800 * y;
        GAM1C += 0.1310 * x;
        SINPI += -0.0028 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[33]; si = siArray[33];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -7.4860 * y;
        DS += -0.6600 * y;
        GAM1C += -0.0370 * x;
        SINPI += -0.0086 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[33]; si = siArray[33];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -8.0960 * y;
        DS += -16.3500 * y;
        GAM1C += -0.7400 * x;
        SINPI += 0.0918 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -5.7410 * y;
        DS += -0.0400 * y;
        GAM1C += 0.0000 * x;
        SINPI += -0.0009 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[31]; si = siArray[31];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.2550 * y;
        DS += 0.0000 * y;
        GAM1C += 0.0000 * x;
        SINPI += 0.0000 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -411.6080 * y;
        DS += -0.2000 * y;
        GAM1C += 0.0000 * x;
        SINPI += -0.0124 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[23]; si = siArray[23];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.5840 * y;
        DS += 0.8400 * y;
        GAM1C += 0.0000 * x;
        SINPI += 0.0071 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -55.1730 * y;
        DS += -52.1400 * y;
        GAM1C += 0.0000 * x;
        SINPI += -0.1052 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[15]; si = siArray[15];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.2540 * y;
        DS += 0.2500 * y;
        GAM1C += 0.0000 * x;
        SINPI += -0.0017 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[11]; si = siArray[11];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.0250 * y;
        DS += -1.6700 * y;
        GAM1C += 0.0000 * x;
        SINPI += 0.0031 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[36]; si = siArray[36];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 1.0600 * y;
        DS += 2.9600 * y;
        GAM1C += -0.1660 * x;
        SINPI += 0.0243 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[36]; si = siArray[36];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 36.1240 * y;
        DS += 50.6400 * y;
        GAM1C += -1.3000 * x;
        SINPI += 0.6215 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[36]; si = siArray[36];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -13.1930 * y;
        DS += -16.4000 * y;
        GAM1C += 0.2580 * x;
        SINPI += -0.1187 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[36]; si = siArray[36];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[11]; si = siArray[11];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -1.1870 * y;
        DS += -0.7400 * y;
        GAM1C += 0.0420 * x;
        SINPI += 0.0074 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[36]; si = siArray[36];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[3]; si = siArray[3];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.2930 * y;
        DS += -0.3100 * y;
        GAM1C += -0.0020 * x;
        SINPI += 0.0046 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.2900 * y;
        DS += -1.4500 * y;
        GAM1C += 0.1160 * x;
        SINPI += -0.0051 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -7.6490 * y;
        DS += -10.5600 * y;
        GAM1C += 0.2590 * x;
        SINPI += -0.1038 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -8.6270 * y;
        DS += -7.5900 * y;
        GAM1C += 0.0780 * x;
        SINPI += -0.0192 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[11]; si = siArray[11];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -2.7400 * y;
        DS += -2.5400 * y;
        GAM1C += 0.0220 * x;
        SINPI += 0.0324 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[21]; si = siArray[21];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 1.1810 * y;
        DS += 3.3200 * y;
        GAM1C += -0.2120 * x;
        SINPI += 0.0213 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[21]; si = siArray[21];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 9.7030 * y;
        DS += 11.6700 * y;
        GAM1C += -0.1510 * x;
        SINPI += 0.1268 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[21]; si = siArray[21];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[23]; si = siArray[23];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.3520 * y;
        DS += -0.3700 * y;
        GAM1C += 0.0010 * x;
        SINPI += -0.0028 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[21]; si = siArray[21];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -2.4940 * y;
        DS += -1.1700 * y;
        GAM1C += -0.0030 * x;
        SINPI += -0.0017 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[21]; si = siArray[21];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[11]; si = siArray[11];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.3600 * y;
        DS += 0.2000 * y;
        GAM1C += -0.0120 * x;
        SINPI += -0.0043 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[33]; si = siArray[33];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -1.1670 * y;
        DS += -1.2500 * y;
        GAM1C += 0.0080 * x;
        SINPI += -0.0106 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[33]; si = siArray[33];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -7.4120 * y;
        DS += -6.1200 * y;
        GAM1C += 0.1170 * x;
        SINPI += 0.0484 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[33]; si = siArray[33];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[11]; si = siArray[11];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.3110 * y;
        DS += -0.6500 * y;
        GAM1C += -0.0320 * x;
        SINPI += 0.0044 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[17]; si = siArray[17];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.7570 * y;
        DS += 1.8200 * y;
        GAM1C += -0.1050 * x;
        SINPI += 0.0112 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[17]; si = siArray[17];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 2.5800 * y;
        DS += 2.3200 * y;
        GAM1C += 0.0270 * x;
        SINPI += 0.0196 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[17]; si = siArray[17];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 2.5330 * y;
        DS += 2.4000 * y;
        GAM1C += -0.0140 * x;
        SINPI += -0.0212 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[37]; si = siArray[37];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.3440 * y;
        DS += -0.5700 * y;
        GAM1C += -0.0250 * x;
        SINPI += 0.0036 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.9920 * y;
        DS += -0.0200 * y;
        GAM1C += 0.0000 * x;
        SINPI += 0.0000 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -45.0990 * y;
        DS += -0.0200 * y;
        GAM1C += 0.0000 * x;
        SINPI += -0.0010 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.1790 * y;
        DS += -9.5200 * y;
        GAM1C += 0.0000 * x;
        SINPI += -0.0833 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[11]; si = siArray[11];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.3010 * y;
        DS += -0.3300 * y;
        GAM1C += 0.0000 * x;
        SINPI += 0.0014 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[18]; si = siArray[18];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -6.3820 * y;
        DS += -3.3700 * y;
        GAM1C += 0.0000 * x;
        SINPI += -0.0481 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[18]; si = siArray[18];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 39.5280 * y;
        DS += 85.1300 * y;
        GAM1C += 0.0000 * x;
        SINPI += -0.7136 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[18]; si = siArray[18];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 9.3660 * y;
        DS += 0.7100 * y;
        GAM1C += 0.0000 * x;
        SINPI += -0.0112 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[18]; si = siArray[18];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[11]; si = siArray[11];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.2020 * y;
        DS += 0.0200 * y;
        GAM1C += 0.0000 * x;
        SINPI += 0.0000 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.4150 * y;
        DS += 0.1000 * y;
        GAM1C += 0.0000 * x;
        SINPI += 0.0013 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -2.1520 * y;
        DS += -2.2600 * y;
        GAM1C += 0.0000 * x;
        SINPI += -0.0066 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[18]; si = siArray[18];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -1.4400 * y;
        DS += -1.3000 * y;
        GAM1C += 0.0000 * x;
        SINPI += 0.0014 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[18]; si = siArray[18];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.3840 * y;
        DS += -0.0400 * y;
        GAM1C += 0.0000 * x;
        SINPI += 0.0000 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[40]; si = siArray[40];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 1.9380 * y;
        DS += 3.6000 * y;
        GAM1C += -0.1450 * x;
        SINPI += 0.0401 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[40]; si = siArray[40];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.9520 * y;
        DS += -1.5800 * y;
        GAM1C += 0.0520 * x;
        SINPI += -0.0130 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[36]; si = siArray[36];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.5510 * y;
        DS += -0.9400 * y;
        GAM1C += 0.0320 * x;
        SINPI += -0.0097 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[36]; si = siArray[36];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.4820 * y;
        DS += -0.5700 * y;
        GAM1C += 0.0050 * x;
        SINPI += -0.0045 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[36]; si = siArray[36];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[21]; si = siArray[21];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.6810 * y;
        DS += 0.9600 * y;
        GAM1C += -0.0260 * x;
        SINPI += 0.0115 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[33]; si = siArray[33];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.2970 * y;
        DS += -0.2700 * y;
        GAM1C += 0.0020 * x;
        SINPI += -0.0009 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[17]; si = siArray[17];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.2540 * y;
        DS += 0.2100 * y;
        GAM1C += -0.0030 * x;
        SINPI += 0.0000 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[37]; si = siArray[37];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.2500 * y;
        DS += -0.2200 * y;
        GAM1C += 0.0040 * x;
        SINPI += 0.0014 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -3.9960 * y;
        DS += 0.0000 * y;
        GAM1C += 0.0000 * x;
        SINPI += 0.0004 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.5570 * y;
        DS += -0.7500 * y;
        GAM1C += 0.0000 * x;
        SINPI += -0.0090 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[18]; si = siArray[18];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.4590 * y;
        DS += -0.3800 * y;
        GAM1C += 0.0000 * x;
        SINPI += -0.0053 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[18]; si = siArray[18];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -1.2980 * y;
        DS += 0.7400 * y;
        GAM1C += 0.0000 * x;
        SINPI += 0.0004 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[32]; si = siArray[32];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[18]; si = siArray[18];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.5380 * y;
        DS += 1.1400 * y;
        GAM1C += 0.0000 * x;
        SINPI += -0.0141 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.2630 * y;
        DS += 0.0200 * y;
        GAM1C += 0.0000 * x;
        SINPI += 0.0000 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[29]; si = siArray[29];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[18]; si = siArray[18];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[19]; si = siArray[19];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.4260 * y;
        DS += 0.0700 * y;
        GAM1C += 0.0000 * x;
        SINPI += -0.0006 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[21]; si = siArray[21];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.3040 * y;
        DS += 0.0300 * y;
        GAM1C += 0.0000 * x;
        SINPI += 0.0003 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[28]; si = siArray[28];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[21]; si = siArray[21];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[18]; si = siArray[18];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[35]; si = siArray[35];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.3720 * y;
        DS += -0.1900 * y;
        GAM1C += 0.0000 * x;
        SINPI += -0.0027 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[42]; si = siArray[42];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += 0.4180 * y;
        DS += 0.0000 * y;
        GAM1C += 0.0000 * x;
        SINPI += 0.0000 * x;
    }
    {
        let x = 1;
        let y = 0;
        let c: number, si: number, nextX: number;
        c = coArray[36]; si = siArray[36];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        c = coArray[34]; si = siArray[34];
        nextX = x*c - y*si; y = y*c + x*si; x = nextX;
        DLAM += -0.3300 * y;
        DS += -0.0400 * y;
        GAM1C += 0.0000 * x;
        SINPI += 0.0000 * x;
    }


    function ADDN(coeffn: number, p: number, q: number, r: number, s: number) {
        Term(p, q, r, s);
        return coeffn * termY;
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
