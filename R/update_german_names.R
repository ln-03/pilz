#!/usr/bin/env Rscript
# Ergänzt ausschließlich deutsche iNaturalist-Namen in data/taxa.json.
# Alte englische common_name-Felder werden NICHT mehr von der App angezeigt.
# Fotos, Beobachtungszahlen und eigene Einträge bleiben unberührt.
suppressPackageStartupMessages({library(jsonlite); library(httr2)})
BASE <- "https://api.inaturalist.org/v1"
`%||%` <- function(a,b) if(is.null(a)) b else a
args_all <- commandArgs(trailingOnly=FALSE); file_arg <- args_all[grepl("^--file=",args_all)]
script_file <- if(length(file_arg)) sub("^--file=","",file_arg[[1]]) else file.path(getwd(),"R","update_german_names.R")
OUT <- normalizePath(file.path(dirname(script_file),".."),mustWork=FALSE)
FILE <- file.path(OUT,"data","taxa.json")
if(!file.exists(FILE)) stop("Nicht gefunden: ", FILE)
taxa <- fromJSON(FILE, simplifyVector=FALSE)
species_idx <- which(vapply(taxa,function(x)(x$rank %||% "")=="species",logical(1)))
for(k in seq_along(species_idx)){
  i <- species_idx[[k]]; x <- taxa[[i]]; Sys.sleep(.12)
  # Absichtlich ohne preferred_place_id: locale=de soll die Sprache bestimmen,
  # nicht ein englischer global/place-preferred common name.
  req <- request(paste0(BASE,"/taxa/",x$id)) |>
    req_url_query(locale="de") |>
    req_user_agent("Pilzraum/4.0 German-name updater") |>
    req_retry(max_tries=4)
  z <- try(req_perform(req) |> resp_body_json(simplifyVector=FALSE),silent=TRUE)
  nm <- NULL
  if(!inherits(z,"try-error") && length(z$results)) nm <- z$results[[1]]$preferred_common_name
  taxa[[i]]$common_name_de <- if(!is.null(nm)&&nzchar(trimws(nm))) trimws(nm) else NULL
  if(k%%25==0 || k==length(species_idx)) message("Deutsche Namen geprüft: ",k," / ",length(species_idx))
}
write_json(taxa,FILE,auto_unbox=TRUE,pretty=TRUE,na="null")
message("Fertig. Die App zeigt jetzt nur common_name_de; falls kein deutscher Name vorhanden ist, bleibt nur der wissenschaftliche Name sichtbar.")
