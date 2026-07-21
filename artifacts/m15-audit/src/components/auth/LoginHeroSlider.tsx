import * as React from "react"

import slide1 from "@assets/IMG-20260324-WA0000_1784634854252.jpg"
import slide2 from "@assets/IMG-20260324-WA0001_1784634854235.jpg"
import slide3 from "@assets/IMG-20260324-WA0002_1784634854211.jpg"

// Module: Login hero diaporama (right-side panel). Purely presentational --
// no data fetching, no auth logic -- so it can be reused on any public
// auth screen (login, register) without side effects.
interface HeroSlide {
  image: string
  alt: string
  title: string
  description: string
}

const SLIDES: HeroSlide[] = [
  {
    image: slide1,
    alt: "Étudiante en comptabilité souriante portant la cravate rouge de M15 Audit",
    title: "Analyse Financière & Diagnostic Stratégique",
    description:
      "Générez instantanément le Z-Score d'Altman et évaluez la valeur de l'entreprise pour conseiller efficacement vos clients.",
  },
  {
    image: slide2,
    alt: "Collaboratrice M15 Audit tenant le guide SYSCOHADA Révisé",
    title: "Facturation Connectée & Saisie de Terrain",
    description:
      "Permettez aux PME et à leurs équipes de terrain d'émettre des factures et d'enregistrer des recettes en temps réel avec auto-génération de pièces.",
  },
  {
    image: slide3,
    alt: "Stagiaire M15 Audit en tenue professionnelle avec le guide SYSCOHADA",
    title: "Formation & Maîtrise SYSCOHADA",
    description:
      "Formez vos équipes aux normes comptables OHADA grâce à un environnement de travail structuré, conforme et pédagogique.",
  },
]

const AUTOPLAY_INTERVAL_MS = 5000

export function LoginHeroSlider() {
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [isPaused, setIsPaused] = React.useState(false)

  // Restarts whenever activeIndex changes so a manual dot click gives the
  // viewer a fresh 5s window instead of cutting the countdown short.
  React.useEffect(() => {
    if (isPaused) return
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % SLIDES.length)
    }, AUTOPLAY_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [activeIndex, isPaused])

  const goToSlide = (index: number) => {
    setActiveIndex(index)
  }

  return (
    <div
      className="relative hidden h-full w-full overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 lg:block"
      role="region"
      aria-roledescription="carousel"
      aria-label="Présentation des fonctionnalités de M15 Audit"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      data-testid="carousel-login-hero"
    >
      {SLIDES.map((slide, index) => {
        const isActive = index === activeIndex
        return (
          <div
            key={slide.title}
            className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
              isActive ? "opacity-100" : "opacity-0"
            }`}
            aria-hidden={!isActive}
          >
            <img
              src={slide.image}
              alt={slide.alt}
              className="h-full w-full object-cover object-top"
              loading={index === 0 ? "eager" : "lazy"}
            />
            {/* Overlay gradient keeps white typography crisp over any photo */}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/50 to-slate-950/20" />
            <div className="absolute inset-0 bg-gradient-to-br from-slate-950/40 via-transparent to-emerald-950/30" />
          </div>
        )
      })}

      {/* Brand mark */}
      <div className="relative z-10 flex items-center gap-2 p-10 font-bold text-lg tracking-tight text-white">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-white/10 font-mono text-sm shadow-sm backdrop-blur-sm">
          M15
        </div>
        AUDIT
      </div>

      {/* Live-announced text content, keyed so it re-triggers its entrance animation on every slide change */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-6 p-10 pb-14 sm:p-12 sm:pb-16">
        <div key={activeIndex} className="max-w-lg animate-in fade-in slide-in-from-bottom-4 duration-700">
          <h2 className="text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl" data-testid="text-hero-title">
            {SLIDES[activeIndex].title}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/80 sm:text-base" data-testid="text-hero-description">
            {SLIDES[activeIndex].description}
          </p>
        </div>

        <div className="flex items-center gap-2" role="tablist" aria-label="Diapositives">
          {SLIDES.map((slide, index) => (
            <button
              key={slide.title}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={`Aller à la diapositive ${index + 1} : ${slide.title}`}
              title={`Diapositive ${index + 1} sur ${SLIDES.length}`}
              onClick={() => goToSlide(index)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                index === activeIndex ? "w-8 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70"
              }`}
              data-testid={`button-slide-dot-${index}`}
            />
          ))}
        </div>
      </div>

      <span className="sr-only" aria-live="polite">
        {SLIDES[activeIndex].title}
      </span>
    </div>
  )
}
