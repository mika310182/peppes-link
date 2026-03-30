# Sistema de Productos Promo - Documentación Técnica

## Resumen de Cambios

Se ha implementado un sistema de selección de pizza base para productos promo especiales, permitiendo al usuario elegir entre diferentes pizzas clásicas manteniendo el precio fijo de la promoción.

## Funciones Implementadas

### 1. `isPromoProduct()`
**Propósito:** Detectar si el producto actual es un promo especial que permite seleccionar pizza base.

**Lógica:**
- Verifica que la categoría sea "promo"
- Filtra productos por día de la semana actual
- Busca si el producto está en la lista especial: `['martes_fest', 'duo_fam_f', 'combo_2']`

**Retorna:** `boolean`

```javascript
const promoIds = ['martes_fest', 'duo_fam_f', 'combo_2'];
```

### 2. `renderExtras()` - Modificada
**Cambios:**
- Ahora verifica si el producto actual es promo especial
- Si es promo especial, muestra selector de pizzas base en lugar de extras
- Las opciones son: Margarita, Jamón Queso, Napolitana, Pepperoni
- Para productos no-promo, mantiene el comportamiento original

**Flujo:**
```
isPromoProduct() → mostrar selector de pizzas base
bebidas/ens/antojos/otro-promo → ocultar contenedor
otras categorías → mostrar extras normales
```

### 3. `handlePromoBaseSelection(pizzaId)`
**Propósito:** Maneja la selección de pizza base para productos promo.

**Acciones:**
- Limpia extras previas: `state.selectedExtras.clear()`
- Agrega pizza base seleccionada: `state.selectedExtras.add(pizzaId)`
- Re-renderiza interfaz: `renderExtras()` + `renderDetails()`

**Parámetro:** `pizzaId` - ID de la pizza (margarita, jamon, napo, pepperoni)

### 4. `addToCart()` - Modificada
**Cambios:**
- Valida que productos promo tengan pizza base seleccionada
- Si falta selección, muestra: `⚠️ Selecciona una pizza base primero.`
- Agrega metadatos al item del carrito si es promo

**Metadatos agregados:**
```javascript
{
  isPromo: true,
  promoType: "martes_fest",      // o "duo_fam_f", "combo_2"
  basePizza: "margarita"          // o "jamon", "napo", "pepperoni"
}
```

### 5. `updateCartUI()` - Modificada
**Cambios:**
- Detecta items de promo por `item.isPromo && item.basePizza`
- Muestra nombre de pizza base en lugar de extras
- Mapeo de IDs a nombres:
  - `'margarita'` → "Margarita"
  - `'jamon'` → "Jamón Queso"
  - `'napo'` → "Napolitana"
  - `'pepperoni'` → "Pepperoni"

## Datos Configurables

### Productos Promo Especiales
```javascript
const promoIds = ['martes_fest', 'duo_fam_f', 'combo_2'];
```

### Pizzas Base Disponibles
```javascript
const basePizzas = [
  { id: 'margarita', name: 'Margarita' },
  { id: 'jamon', name: 'Jamón Queso' },
  { id: 'napo', name: 'Napolitana' },
  { id: 'pepperoni', name: 'Pepperoni' }
];
```

## Flujo de Usuario

1. Usuario navega a categoría "Promo"
2. Selecciona producto (ej: "Martes Fest")
3. En lugar de extras, ve selector de pizzas base
4. Selecciona una pizza (ej: "Margarita")
5. La pizza base se resalta (clase `isActive`)
6. Al agregar al carrito:
   - Se valida que hay pizza base seleccionada
   - Se guarda con metadatos: `{isPromo: true, promoType: "martes_fest", basePizza: "margarita"}`
7. En el carrito muestra: "Martes Fest | Margarita"

## HTML sin Cambios

Se mantiene sin modificaciones:
- Estructura del DOM
- IDs y clases CSS
- Contenedor `#extrasContainer`
- Secciones `#extraTitle` y `#extrasArea`

## Compatibilidad

✅ Funciona con sistema de extras existente (pizzas regulares)
✅ No afecta otras categorías (bebidas, ensaladas, etc.)
✅ Compatible con sistema de delivery GPS
✅ Compatible con carrito y checkout existentes
