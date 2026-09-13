#!/usr/bin/env Rscript
# Pilzraum: nur die TOP-N häufigsten Pilzarten im iNaturalist-Place "Black Forest, DE"
# plus komplette Linie bis zum Reich und bis zu 4 Offline-Fotos pro Art.
# R >= 4.2; Pakete: jsonlite, httr2, dplyr, purrr, readr, tibble

suppressPackageStartupMessages({library(jsonlite);library(httr2);library(dplyr);library(purrr);library(readr);library(tibble)})
BASE <- "https://api.inaturalist.org/v1"; `%||%` <- function(a,b) if(is.null(a)) b else a
args_all <- commandArgs(trailingOnly=FALSE); file_arg <- args_all[grepl("^--file=",args_all)]
script_file <- if(length(file_arg)) sub("^--file=","",file_arg[[1]]) else file.path(getwd(),"R","build_inaturalist_data.R")
OUT <- normalizePath(file.path(dirname(script_file),".."),mustWork=FALSE)
dir.create(file.path(OUT,"data"),showWarnings=FALSE,recursive=TRUE);dir.create(file.path(OUT,"assets","inat"),showWarnings=FALSE,recursive=TRUE)
PLACE_ID <- Sys.getenv("INAT_PLACE_ID",unset="125296"); FUNGI_TAXON_ID <- 47170
TOP_N <- as.integer(Sys.getenv("PILZRAUM_TOP_N",unset="200")); PHOTO_N <- 4; SLEEP <- 0.15
api_get <- function(path,query=list()){Sys.sleep(SLEEP);request(paste0(BASE,path))|>req_url_query(!!!query)|>req_user_agent("Pilzraum/3.0 educational offline field app")|>req_retry(max_tries=4)|>req_perform()|>resp_body_json(simplifyVector=FALSE)}
cache <- new.env(parent=emptyenv()); get_taxon <- function(id){k<-as.character(id);if(exists(k,cache,inherits=FALSE))return(get(k,cache,inherits=FALSE));x<-api_get(paste0("/taxa/",k),list(locale="de"))$results[[1]];assign(k,x,cache);x}

message("1/4 Häufigste Schwarzwald-Pilztaxa laden (Ziel: ",TOP_N," Species) …")
# Wir laden nur so viele Species-Count-Seiten wie nötig, NICHT alle ~2000 Taxa.
counts <- list(); page <- 1; max_pages <- 8
repeat{
  res <- api_get("/observations/species_counts",list(place_id=PLACE_ID,taxon_id=FUNGI_TAXON_ID,rank="species",per_page=200,page=page,order_by="observations_count",order="desc"))
  rr <- res$results %||% list(); if(!length(rr))break; counts<-c(counts,rr)
  message("  Kandidaten: ",length(counts)); if(length(counts)>=TOP_N||page>=max_pages)break; page<-page+1
}
if(!length(counts))stop("Keine Taxa gefunden. Place-ID/API prüfen.")

message("2/4 Taxonomie der Top-Arten auflösen …")
sp <- list(); lineages <- list()
for(i in seq_along(counts)){
  tx <- get_taxon(counts[[i]]$taxon$id); chain <- c(tx$ancestors %||% list(),list(tx)); chain <- keep(chain,~(.x$rank%||%"")%in%c("kingdom","phylum","class","order","family","genus","species")); species_nodes <- keep(chain,~(.x$rank%||%"")=="species"); if(!length(species_nodes))next
  s <- species_nodes[[length(species_nodes)]]; sid <- as.character(s$id)
  if(is.null(sp[[sid]])){sp[[sid]]<-list(id=sid,count=as.integer(counts[[i]]$count%||%0),taxon=s);lineages[[sid]]<-chain}else sp[[sid]]$count<-sp[[sid]]$count+as.integer(counts[[i]]$count%||%0)
  if(length(sp)>=TOP_N)break
}
if(length(sp)<TOP_N)message("Warnung: nur ",length(sp)," eindeutige Species gefunden.")
ids <- names(sp); ord <- order(vapply(sp,function(x)x$count,numeric(1)),decreasing=TRUE); ids<-ids[ord][seq_len(min(TOP_N,length(ids)))]
rows<-list();for(sid in ids){chain<-lineages[[sid]];for(j in seq_along(chain)){t<-chain[[j]];rows[[length(rows)+1]]<-tibble(id=as.character(t$id),parent_id=if(j>1)as.character(chain[[j-1]]$id)else NA_character_,name=t$name,rank=t$rank,common_name_de=t$preferred_common_name%||%NA_character_,obs_count=if(t$rank=="species")sp[[sid]]$count else 0L)}}
taxa<-bind_rows(rows)|>distinct(id,.keep_all=TRUE)

message("3/4 Bis zu vier Fotos für ",length(ids)," Arten herunterladen …")
photo_map<-setNames(vector("list",nrow(taxa)),taxa$id)
for(i in seq_along(ids)){
  id<-ids[[i]]; obs<-api_get("/observations",list(place_id=PLACE_ID,taxon_id=id,photos="true",per_page=24,page=1,order_by="votes",order="desc"))$results%||%list(); urls<-character()
  for(o in obs)for(ph in(o$photos%||%list())){u<-ph$url%||%"";if(nzchar(u))urls<-c(urls,sub("square","small",u,fixed=TRUE))}
  urls<-head(unique(urls),PHOTO_N); local<-character()
  for(j in seq_along(urls)){rel<-file.path("assets","inat",paste0(id,"_",j,".jpg"));dest<-file.path(OUT,rel);ok<-try(download.file(urls[[j]],dest,mode="wb",quiet=TRUE),silent=TRUE);if(!inherits(ok,"try-error")&&file.exists(dest))local<-c(local,gsub("\\\\","/",rel))}
  photo_map[[id]]<-local;if(i%%25==0)message("  Fotos ",i," / ",length(ids))
}

message("4/4 JSON/CSV schreiben …")
records<-lapply(seq_len(nrow(taxa)),function(i){r<-taxa[i,];z<-list(id=r$id[[1]],parent_id=if(is.na(r$parent_id[[1]]))NULL else r$parent_id[[1]],name=r$name[[1]],rank=r$rank[[1]],obs_count=as.integer(r$obs_count[[1]]),base_set=TRUE);if(!is.na(r$common_name_de[[1]]))z$common_name_de<-r$common_name_de[[1]];pp<-photo_map[[r$id[[1]]]];if(length(pp))z$inat_photos<-pp;z})
write_json(records,file.path(OUT,"data","taxa.json"),auto_unbox=TRUE,pretty=TRUE,na="null");write_csv(taxa,file.path(OUT,"data","taxa.csv"),na="")
message("Fertig: ",length(ids)," Basisarten, ",nrow(taxa)," Nodes insgesamt.")
