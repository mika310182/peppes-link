# PEPPE'S ENGINEERING & DESIGN RULES

## 1. Filosofía del Proyecto

- **Producto real en producción.** Peppe's no es un sandbox ni un experimento. Cada cambio impacta pedidos reales de clientes en Antofagasta.
- **Priorizar estabilidad sobre creatividad innecesaria.** La mejor feature es la que no rompe nada.
- **Cambios quirúrgicos y seguros.** Modificar solo los archivos necesarios, con la menor cantidad de líneas posible.
- **Mantener compatibilidad legacy.** El código existente puede no ser perfecto, pero funciona en producción. No reescribir sin solicitud explícita.
- **Nada de refactors masivos sin solicitud explícita del usuario.**
- **Cada cambio debe ser deploy-safe.** Si hay duda, no se deploya.
- **Código limpio, mantenible y auditable.** Un desarrollador nuevo debe entender el cambio en segundos.

## 2. Filosofía Visual

Peppe's debe sentirse como un producto premium, no como un proyecto amateur.

**Objetivo estético:**
- Premium
- Moderno
- Mobile-first
- Refinado
- Tipo app iOS nativa
- Inspirado en Apple, Stripe, Linear y apps SaaS de alto nivel

**Evitar:**
- UI genérica o plantillera
- Exceso de colores
- Efectos exagerados (sombras agresivas, gradientes estridentes, animaciones llamativas)
- Ruido visual innecesario
- Duplicación de información (ej: microcopy redundante con badges)
- Interfaces sobrecargadas

**Cada elemento debe tener una razón de existir.** Si no suma, resta.

## 3. Sistema de Diseño

Mantener consistencia visual en toda la aplicación:

- **Spacing limpio** — padding y márgenes consistentes, sin valores arbitrarios
- **Bordes suaves** — radios moderados (`12px`–`24px`), sin ángulos agresivos
- **Glassmorphism sutil** — backdrop-filter con opacidades bajas, sin exagerar
- **Contrastes premium** — texto legible, fondos que no compiten con el contenido
- **Tipografía limpia** — Poppins para cuerpo, Titan One para títulos (mantener el sistema actual)
- **Jerarquía visual clara** — lo importante se ve primero, lo secundario se atenúa
- **Animaciones suaves y mínimas** — cubic-bezier refinado, duraciones cortas, sin movimientos innecesarios
- **Diseño táctil mobile-first** — touch targets >= 44px, gestos naturales, scroll suave

**Referencias internas de diseño aprobado:**
- Modal de cupones premium (estilo moderno, sin ruido)
- Analytics dashboard (limpio, informativo, minimal)
- Estética iOS dark premium (fondos oscuros, acentos rojos, tipografía limpia)

## 4. Arquitectura y Seguridad

**Nunca romper estos sistemas bajo ninguna circunstancia:**

- Checkout / flujo de pedido
- Mercado Pago (create-preference, webhook, init_point, back_urls)
- Firebase (realtime database, estructura de nodos, listeners)
- Admin panel (dashboard, inventario, pedidos, cupones, analytics)
- Webhooks (mp-webhook, confirm-payment, get-order)
- Cupones (validación, aplicación, descuento)
- Tracking de pedidos (checkActiveOrder, polling, estado en tiempo real)

**Antes de modificar cualquier archivo:**
1. Auditar el flujo completo involucrado
2. Identificar la causa raíz del problema
3. Determinar exactamente qué archivos necesitan cambio
4. Hacer el cambio mínimo que resuelva el problema

## 5. Forma de Trabajo

**Siempre:**
1. Auditar antes de modificar — entender el código existente, sus dependencias y su contexto
2. Explicar la causa raíz — no solo el síntoma
3. Hacer cambios mínimos — una línea si es suficiente, un archivo si es posible
4. Evitar regresiones — probar que el cambio no rompa funcionalidades adyacentes
5. Entregar resumen de cambios — archivos modificados, qué cambió, por qué
6. Explicar cómo probar — pasos concretos para verificar el fix
7. Mantener consola limpia — sin logs de debug, warnings o errores nuevos
8. Mantener performance — el cambio no debe degradar tiempo de carga ni experiencia

**Nunca:**
- Agregar features no solicitadas por el usuario
- Cambiar diseño fuera del scope acordado
- Mover lógica crítica innecesariamente
- Reemplazar arquitectura existente sin aprobación explícita

## 6. Performance

**Prioridades (en orden):**
1. **Mobile performance** — la mayoría de los usuarios entra desde celular
2. **Core Web Vitals** — LCP < 2.5s, FID < 100ms, CLS < 0.1
3. **Carga rápida** — primer paint en < 1.5s en 3G
4. **Minimizar CLS** — dimensiones explícitas en imágenes, font-display: swap, evitar inyecciones que muevan layout
5. **Minimizar JS bloqueante** — defer/async en scripts no críticos, Firebase SDK al final del body
6. **Lazy loading inteligente** — imágenes below-fold con `loading="lazy"`, no aplicar a above-the-fold
7. **Imágenes optimizadas** — WebP cuando sea posible, evitar PNG gigantes (2000x2000)
8. **Evitar loops infinitos** — listeners de Firebase deben tener cleanup, intervals deben tener límite
9. **Evitar renders innecesarios** — no regenerar el DOM completo si solo cambia un valor

## 7. SEO & Growth Engineering

Pensar como un Senior SEO Engineer + Growth Engineer + CRO Specialist combinados.

**Objetivos permanentes:**
- Mejorar Google Ads Quality Score
- Dominar SEO local en Antofagasta
- Maximizar conversión mobile
- Generar confianza visual
- Mantener UX limpia y premium
- Keywords integradas de forma natural (nada de keyword stuffing visual)

**Priorizar:**
- Schema.org (LocalBusiness, Restaurant, MenuItem, BreadcrumbList)
- Metadata limpia (title, description, OG, Twitter Cards por página)
- Semantic HTML (headings jerárquicos, landmarks, alt texts)
- Performance SEO (velocidad = factor de ranking)
- Trust signals visibles (medios de pago, ingredientes, delivery)
- UX de conversión (CTA claro, fricción mínima, validación progresiva)

## 8. Reglas de Producción

Todo cambio debe funcionar en:

- **Mobile Safari** — el browser más restrictivo (ITP, deeplinks, cache agresivo)
- **Chrome mobile** — el más usado
- **Desktop** — Chrome, Safari, Edge
- **Vercel production** — el entorno de deploy real
- **Firebase realtime** — datos en vivo, listeners activos
- **Pedidos reales** — el flujo completo debe funcionar de principio a fin

**No dejar en producción:**
- `console.log` de debug (solo `console.warn` / `console.error` para errores reales)
- Errores 404 en assets, rutas o APIs
- Errores en consola del browser
- Assets rotos o referencias a archivos que no existen
- Imports o código muerto
- CSS huérfano (reglas que no se aplican a nada)
- Código duplicado

## 9. Estándar de Calidad

Peppe's debe sentirse como:

- Un producto startup premium, no un proyecto universitario
- Una app moderna de alto nivel, no un sitio web genérico
- Una experiencia cuidada al detalle, no funcionalidad a medias

**La calidad esperada es:**
- **Producción profesional** — sin errores, sin warnings, sin fallas visibles
- **UX refinada** — cada interacción se siente pensada
- **Rendimiento alto** — carga rápida, sin jank, sin CLS
- **Estabilidad total** — los pedidos siempre llegan, los pagos siempre procesan
- **Estética impecable** — alineación, espaciado, tipografía, colores, todo consistente

## 10. Regla Final

Toda modificación futura debe:

1. **Leer AGENTS.md primero**
2. Respetar todas las reglas aquí definidas
3. Mantener coherencia visual y técnica con el proyecto existente
4. Priorizar: **estabilidad > performance > estética > features nuevas**
