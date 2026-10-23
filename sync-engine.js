export class ProgressSync {
  constructor({adapter,load,store,onStatus=()=>{},onRemote=()=>{},onConflict=()=>{}}) {
    Object.assign(this,{adapter,load,store,onStatus,onRemote,onConflict});
    this.user=null;this.generation=0;this.pending=null;this.running=false;this.conflict=false;this.revision=0;
  }
  async connect(user) {
    const generation=++this.generation;this.user=user;this.conflict=false;this.pending=null;
    if(!user)return;
    const cache=this.load(user)||{};this.revision=cache.revision||0;
    this.pending=cache.dirty?cache.state:null;
    this.onStatus('loading');
    try {
      const remote=await this.adapter.read(user);
      if(generation!==this.generation)return;
      if(cache.dirty && remote && remote.revision!==this.revision) {
        this.conflict=true;this.onConflict(remote);this.onStatus('conflict');return;
      }
      if(cache.dirty){this.onRemote(cache.state);await this.flush();return;}
      if(remote){this.revision=remote.revision;this.store(user,{state:remote.state,revision:this.revision,dirty:false});this.onRemote(remote.state);}
      else if(cache.state){this.onRemote(cache.state);this.pending=cache.state;await this.flush();return;}
      this.onStatus('synced');
    }catch(error){if(generation===this.generation){if(cache.state)this.onRemote(cache.state);this.onStatus('offline',error);}}
  }
  changed(state) {
    if(!this.user)return;
    this.pending=structuredClone(state);
    this.store(this.user,{state:this.pending,revision:this.revision,dirty:true});
    this.onStatus(this.conflict?'conflict':'pending');
  }
  async flush() {
    if(!this.user||this.running||this.conflict||!this.pending)return;
    const generation=this.generation,user=this.user;this.running=true;
    try {
      while(this.pending&&!this.conflict&&generation===this.generation){
        const snapshot=this.pending;this.onStatus('saving');
        const result=await this.adapter.write(user,snapshot,this.revision);
        if(generation!==this.generation)return;
        if(result.conflict){this.conflict=true;this.onStatus('conflict');this.onConflict(result.remote);return;}
        this.revision=result.revision;
        if(this.pending===snapshot)this.pending=null;
        this.store(user,{state:this.pending||snapshot,revision:this.revision,dirty:!!this.pending});
      }
      if(generation===this.generation)this.onStatus('synced');
    }catch(error){if(generation===this.generation)this.onStatus('offline',error);}
    finally{this.running=false;}
  }
  async useRemote(){
    if(!this.user)return;
    const user=this.user,generation=this.generation;this.onStatus('loading');
    try{const remote=await this.adapter.read(user);if(generation!==this.generation)return;if(!remote)throw Error('No saved progress found');
      const local=this.load(user);if(local?.state)this.store(user+'-backup-'+Date.now(),local);
      this.pending=null;this.conflict=false;this.revision=remote.revision;
      this.store(user,{state:remote.state,revision:this.revision,dirty:false});this.onRemote(remote.state);this.onStatus('synced');
    }catch(error){this.onStatus('offline',error);}
  }
  disconnect(){this.generation++;this.user=null;this.pending=null;this.conflict=false;}
}
