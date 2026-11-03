// Convierte las recomendaciones del SMN (escritas con voseo) a español neutro (usted).
// Tabla compacta "voseo=neutro" separada por espacios; lo que no está en la tabla queda igual.
const TABLA = `
evitá=evite sacá=saque saques=saque limpiá=limpie desconectá=desconecte conectá=conecte
cortá=corte cerrá=cierre cerá=cierre abrí=abra retirá=retire asegurá=asegure aseguá=asegure
buscá=busque mantené=mantenga prestá=preste seguí=siga segui=siga andá=vaya usá=use
utilizá=utilice revisá=revise guardá=guarde tomá=tome bebé=beba consultá=consulte llamá=llame
escuchá=escuche verificá=verifique controlá=controle cubrí=cubra salí=salga entrá=entre
subí=suba bajá=baje apagá=apague encendé=encienda colocá=coloque cargá=cargue mové=mueva
avisá=avise cuidá=cuide dejá=deje hacé=haga mirá=mire ayudá=ayude respetá=respete
circulá=circule conducí=conduzca manejá=maneje estacioná=estacione alejá=aleje protegé=proteja
ventilá=ventile hidratá=hidrate descansá=descanse informá=informe llevá=lleve tené=tenga poné=ponga
alejate=aléjese quedate=quédese resguardate=resguárdese refugiate=refúgiese protegete=protéjase
cubrite=cúbrase informate=infórmese hidratate=hidrátese abrigate=abríguese asegurate=asegúrese
acercate=acérquese ubicate=ubíquese preparate=prepárese fijate=fíjese ponete=póngase
quitate=quítese movete=muévase sentate=siéntese
refugies=refugie expongas=exponga salgas=salga uses=use dejes=deje toques=toque cruces=cruce
acerques=acerque quedes=quede olvides=olvide camines=camine corras=corra manejes=maneje
estaciones=estacione arrojes=arroje tires=tire prendas=prenda enciendas=encienda abras=abra
subas=suba bajes=baje guardes=guarde permanezcas=permanezca esperes=espere intentes=intente
circules=circule ingreses=ingrese pises=pise
estás=está tenés=tiene podés=puede debés=debe sabés=sabe vivís=vive sos=es querés=quiere
te=se vos=usted ti=usted tu=su tus=sus tuyo=suyo tuya=suya
`;

const DICCIONARIO = Object.fromEntries(
  TABLA.trim().split(/\s+/).map((par) => par.split('='))
);

function conMayuscula(original, reemplazo) {
  const a = original[0];
  return a === a.toUpperCase() && a !== a.toLowerCase() ? reemplazo[0].toUpperCase() + reemplazo.slice(1) : reemplazo;
}

export function aEspanolNeutro(texto) {
  return String(texto ?? '').replace(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g, (palabra) => {
    const r = DICCIONARIO[palabra.toLowerCase()];
    return r ? conMayuscula(palabra, r) : palabra;
  });
}

/** Separa las recomendaciones numeradas ("1- ... 2- ...") en una lista. */
export function recomendaciones(instruction) {
  const t = aEspanolNeutro(String(instruction ?? '').replace(/\s+/g, ' ').trim());
  if (!t) return [];
  const partes = t
    .split(/(?=\b\d{1,2}\s*[-.)]\s)/)
    .map((p) => p.replace(/^\s*\d{1,2}\s*[-.)]\s*/, '').trim())
    .filter(Boolean);
  return (partes.length > 1 ? partes : [t]).map((p) => (/[.!?]$/.test(p) ? p : p + '.'));
}
