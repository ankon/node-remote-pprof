#include <node.h>
#include <nan.h>

#include "gperftools/malloc_extension.h"
namespace gperftools {
#include "gperftools/heap-profiler.h"
#include "gperftools/profiler.h"
}

namespace extension {

using Nan::FunctionCallbackInfo;

using v8::FunctionTemplate;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::Boolean;
using v8::Date;
using v8::Number;
using v8::String;
using v8::Value;

NAN_METHOD(GetHeapSample) {
  MallocExtensionWriter output;
  MallocExtension::instance()->GetHeapSample(&output);

  info.GetReturnValue().Set(Nan::New<String>(output).ToLocalChecked());
}


NAN_METHOD(GetHeapGrowthStacks) {
  MallocExtensionWriter output;
  MallocExtension::instance()->GetHeapGrowthStacks(&output);

  info.GetReturnValue().Set(Nan::New<String>(output).ToLocalChecked());
}

NAN_METHOD(IsHeapProfilerRunning) {
  info.GetReturnValue().Set(Nan::New<Boolean>(gperftools::IsHeapProfilerRunning()));
}

NAN_METHOD(HeapProfilerStart) {
  Nan::Utf8String prefix(info[0]);
  int len = prefix.length();
  if (len <= 0) {
    return Nan::ThrowTypeError("arg must be a non-empty string");
  }

  gperftools::HeapProfilerStart(*prefix);
}

NAN_METHOD(HeapProfilerStop) {
  gperftools::HeapProfilerStop();
}

NAN_METHOD(GetHeapProfile) {
  char *profile = gperftools::GetHeapProfile();
  if (!profile) {
    Nan::ThrowError("Cannot get a heap profile");
  }

  info.GetReturnValue().Set(Nan::New<String>(profile).ToLocalChecked());
  free(profile);
}

NAN_METHOD(ProfilerStart) {
  Nan::Utf8String filename(info[0]);
  int len = filename.length();
  if (len <= 0) {
    return Nan::ThrowTypeError("arg must be a non-empty string");
  }

  int result = gperftools::ProfilerStart(*filename);
  info.GetReturnValue().Set(Nan::New<Boolean>(result != 0));
}

NAN_METHOD(ProfilerStop) {
  gperftools::ProfilerStop();
}

NAN_METHOD(ProfilerGetCurrentState) {
  gperftools::ProfilerState state;
  gperftools::ProfilerGetCurrentState(&state);

  Local<Object> obj = Nan::New<Object>();
  Nan::Set(obj, Nan::New<String>("enabled").ToLocalChecked(), Nan::New<Boolean>(state.enabled != 0));
  Nan::Set(obj, Nan::New<String>("startTime").ToLocalChecked(), Nan::New<Date>(state.start_time * 1000.0).ToLocalChecked());
  Nan::Set(obj, Nan::New<String>("profileName").ToLocalChecked(), Nan::New<String>(state.profile_name).ToLocalChecked());
  Nan::Set(obj, Nan::New<String>("samplesGathered").ToLocalChecked(), Nan::New<Number>(state.samples_gathered));

  info.GetReturnValue().Set(obj);
}

NAN_MODULE_INIT(Initialize) {
  // malloc extensions (many missing)
  NAN_EXPORT(target, GetHeapSample);
  NAN_EXPORT(target, GetHeapGrowthStacks);

  // heap-profiler
  NAN_EXPORT(target, IsHeapProfilerRunning);
  NAN_EXPORT(target, HeapProfilerStart);
  NAN_EXPORT(target, HeapProfilerStop);
  NAN_EXPORT(target, GetHeapProfile);

  // profiler
  NAN_EXPORT(target, ProfilerStart);
  NAN_EXPORT(target, ProfilerStop);
  NAN_EXPORT(target, ProfilerGetCurrentState);
}

NODE_MODULE(NODE_GYP_MODULE_NAME, Initialize)

}
